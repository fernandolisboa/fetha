import { engine as realEngine, type Engine, type Score } from "@fetha/engine";
import type { Structure } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { calendarUpTo, freshness } from "@/modules/market-data";
import { StructuresRepository } from "@/modules/strategies";

import { DecisionScoresRepository, type NewDecisionScore } from "./decision-scores-repository";
import { dueDecisionUserIds } from "./due-decision-users";
import { buildScoreInput } from "./score-input";

export interface ScoreDueDecisionsInput {
  // Every session this run's own ingestion actually drained cleanly
  // (`IngestOutcome.okSessions`), or an empty array when the caller's
  // cotahist step failed or ingested nothing: the fallback below then
  // resolves the newest previously-succeeded session on its own, so a
  // re-run with nothing new to ingest still scores decisions a *previous*
  // night's ingestion already covers.
  okSessions: readonly string[];
}

export interface ScoreDecisionsOptions {
  // Epoch ms after which no further user is started this run; the ones
  // already in flight still finish (same contract as
  // `EvaluateSignalsOptions.deadlineAt`).
  deadlineAt?: number;
  now?: () => number;
  // A test seam, not a documentation of engine incompleteness (#29 fix-web
  // item 11): lets the job's own orchestration (due selection, idempotency,
  // append-only, isolation, error handling) be unit/integration-tested with
  // a fake engine, independent of whatever `@fetha/engine`'s `score()`
  // itself does. The real engine (`@fetha/engine`) is the default.
  engine?: Pick<Engine, "score">;
}

export interface ScoreErrorEntry {
  decisionId: string | null;
  kind: string;
}

export interface ScoreDecisionsOutcome {
  asOfSession: string;
  usersScored: number;
  usersSkipped: number;
  decisionsScored: number;
  decisionsSkipped: number;
  errors: ScoreErrorEntry[];
}

// Only `insufficient_data` is worth a next-run retry (#29 fix-web item 8):
// every other engine error code (`invalid_input`, `missing_instrument`,
// `unsupported`, `no_series_matches`, `degenerate_strikes`, `unsizeable`,
// `checkpoint_mismatch`) describes a condition tomorrow's run cannot fix on
// its own, so it becomes an unscorable row on first sight instead of
// retrying forever.
const RETRIABLE_ERROR_CODE = "insufficient_data";

// `insufficient_data` stops being retried once the as-of session has moved
// this many trading sessions past the decision's own resolved horizon (#29
// fix-web item 8): data that is still missing this long after the horizon
// arrived is a permanent gap (a source that stopped publishing, an
// instrument that was delisted), not a night away from catching up.
const INSUFFICIENT_DATA_RETRY_SESSIONS = 5;

function newestSession(sessions: readonly string[]): string | undefined {
  return [...sessions].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).at(-1);
}

// The newest session cotahist actually has data for (#29 fix-web item 11):
// moved here from the cron route so the "what session is a decision due
// against" rule lives with the rest of the scoring job's own orchestration.
// Falls back to the newest *succeeded* cotahist ingestion run, never the
// latest run regardless of outcome — a run that failed leaves the previous
// night's succeeded session as the correct fallback, not "no session at
// all".
async function resolveAsOfSession(
  db: Database,
  input: ScoreDueDecisionsInput,
): Promise<string | undefined> {
  const newest = newestSession(input.okSessions);
  if (newest) {
    return newest;
  }
  const runs = await freshness(db);
  return runs.find((run) => run.source === "cotahist" && run.status === "succeeded")?.session;
}

function scoredNewDecisionScore(decisionId: string, score: Score, engineVersion: string): NewDecisionScore {
  const pnlCentavos = score.pnl;
  const maxLossUnbounded = score.maxLoss === "unbounded";
  const maxLossCentavos = score.maxLoss === null || score.maxLoss === "unbounded" ? null : score.maxLoss;
  const normalizedPnl = score.normalizedPnl;
  const claimHeld = score.thesis.claim === null ? null : score.thesis.held;
  const brier = score.thesis.claim === null ? null : score.thesis.brier;
  const counterfactualPnlCentavos = score.counterfactualPnl;

  return {
    decisionId,
    score,
    pnlCentavos,
    maxLossCentavos,
    maxLossUnbounded,
    normalizedPnl,
    claimHeld,
    brier,
    counterfactualPnlCentavos,
    engineVersion,
  };
}

function unscorableNewDecisionScore(decisionId: string, reason: string): NewDecisionScore {
  return { decisionId, unscorableReason: reason, engineVersion: realEngine.capabilities().engineVersion };
}

async function insufficientDataExhausted(
  db: Database,
  resolvedHorizon: string,
  asOfSession: string,
): Promise<boolean> {
  const calendar = await calendarUpTo(db, new Date(`${asOfSession}T23:59:59.999Z`));
  const sessionsSinceHorizon = calendar.filter((session) => session.date > resolvedHorizon).length;
  return sessionsSinceHorizon >= INSUFFICIENT_DATA_RETRY_SESSIONS;
}

// Chained after evaluation in the same cron run (brief item 2, CONTEXT.md
// "Nightly ingestion and daily evaluation"): scores every decision whose
// horizon has arrived — `horizon <= asOfSession`, the latest session
// cotahist actually drained — and that has no score yet. Every read and
// write goes through `DecisionScoresRepository` constructed with the
// decision's own `user_id` (mirroring `evaluateSignalsForSession`'s use of
// `activeStrategyUserIds` + a per-user `SignalsRepository`), so a run can
// never score or read across a tenant boundary. Idempotent: a decision
// already scored (or already marked unscorable) is simply absent from
// `dueForUser` on the next run, and the unique index on
// `decision_scores.decision_id` makes a concurrent or re-run insert a
// no-op even if two runs ever raced. Error isolation is two layers deep
// (#29 fix-web item 6): one user's failure never aborts the run for the
// next user, and one decision's failure never aborts the rest of that
// user's own due list.
export async function scoreDueDecisions(
  db: Database,
  input: ScoreDueDecisionsInput,
  options: ScoreDecisionsOptions = {},
): Promise<ScoreDecisionsOutcome> {
  const now = options.now ?? Date.now;
  const scoringEngine = options.engine ?? realEngine;

  const asOfSession = await resolveAsOfSession(db, input);
  if (!asOfSession) {
    return { asOfSession: "", usersScored: 0, usersSkipped: 0, decisionsScored: 0, decisionsSkipped: 0, errors: [] };
  }

  // Resolved once per run, not once per decision (#29 fix-web item 11): the
  // structure catalog is shared reference data (ADR-0012) that never
  // changes mid-run.
  const structures: readonly Structure[] = await new StructuresRepository(db).listAll();

  const userIds = await dueDecisionUserIds(db, asOfSession);

  let usersScored = 0;
  let usersSkipped = 0;
  let decisionsScored = 0;
  let decisionsSkipped = 0;
  const errors: ScoreErrorEntry[] = [];

  for (const userId of userIds) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      usersSkipped += 1;
      continue;
    }
    const scopedUser = { id: userId };
    try {
      const repository = new DecisionScoresRepository(db, scopedUser);
      const due = await repository.dueForUser(asOfSession);
      let scoredAny = false;

      for (const row of due) {
        if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
          break;
        }

        try {
          const built = await buildScoreInput(db, scopedUser, row, structures);
          if (!built.ok) {
            decisionsSkipped += 1;
            errors.push({ decisionId: row.id, kind: `build_failed:${built.reason}` });
            await repository.insertIfAbsent(unscorableNewDecisionScore(row.id, `build_failed:${built.reason}`));
            continue;
          }

          const result = await scoringEngine.score(built.input);
          if (!result.ok) {
            decisionsSkipped += 1;
            if (result.error.code === RETRIABLE_ERROR_CODE) {
              const exhausted = await insufficientDataExhausted(db, built.input.horizon, asOfSession);
              if (exhausted) {
                errors.push({ decisionId: row.id, kind: `unscorable:${RETRIABLE_ERROR_CODE}` });
                await repository.insertIfAbsent(unscorableNewDecisionScore(row.id, RETRIABLE_ERROR_CODE));
              }
              continue;
            }
            errors.push({ decisionId: row.id, kind: `engine_error:${result.error.code}` });
            await repository.insertIfAbsent(
              unscorableNewDecisionScore(row.id, `engine_error:${result.error.code}`),
            );
            continue;
          }

          const engineVersion = result.value.provenance.engineVersion;
          const { inserted } = await repository.insertIfAbsent(
            scoredNewDecisionScore(row.id, result.value, engineVersion),
          );
          if (inserted) {
            decisionsScored += 1;
            scoredAny = true;
          }
        } catch {
          decisionsSkipped += 1;
          errors.push({ decisionId: row.id, kind: "scoring_failed" });
        }
      }

      if (scoredAny) {
        usersScored += 1;
      }
    } catch {
      errors.push({ decisionId: null, kind: "scoring_failed" });
    }
  }

  return { asOfSession, usersScored, usersSkipped, decisionsScored, decisionsSkipped, errors };
}
