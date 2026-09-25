import { engine as realEngine, type Engine, type Score } from "@fetha/engine";

import type { Database } from "@/db/client";

import { DecisionScoresRepository, type NewDecisionScore } from "./decision-scores-repository";
import { dueDecisionUserIds } from "./due-decision-users";
import { buildScoreInput } from "./score-input";

export interface ScoreDecisionsOptions {
  // Epoch ms after which no further user is started this run; the ones
  // already in flight still finish (same contract as
  // `EvaluateSignalsOptions.deadlineAt`).
  deadlineAt?: number;
  now?: () => number;
  // Injectable so the job's orchestration (due selection, idempotency,
  // append-only, isolation, error handling) can be unit/integration-tested
  // with a fake engine before `engine.score` itself lands (#29 brief): the
  // real engine (`@fetha/engine`) is the default.
  engine?: Pick<Engine, "score">;
}

export interface ScoreDecisionsOutcome {
  asOfSession: string;
  usersScored: number;
  usersSkipped: number;
  decisionsScored: number;
  decisionsSkipped: number;
  errors: string[];
}

const RETRIABLE_ERROR_CODES = new Set(["insufficient_data", "unsupported"]);

function toNewDecisionScore(
  decisionId: string,
  score: Score,
  engineVersion: string,
): NewDecisionScore {
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

// Chained after evaluation in the same cron run (brief item 2, CONTEXT.md
// "Nightly ingestion and daily evaluation"): scores every decision whose
// horizon has arrived — `horizon <= asOfSession`, the latest session
// cotahist actually drained — and that has no score yet. Every read and
// write goes through `DecisionScoresRepository` constructed with the
// decision's own `user_id` (mirroring `evaluateSignalsForSession`'s use of
// `activeStrategyUserIds` + a per-user `SignalsRepository`), so a run can
// never score or read across a tenant boundary. Idempotent: a decision
// already scored is simply absent from `dueForUser` on the next run, and
// the unique index on `decision_scores.decision_id` makes a concurrent or
// re-run insert a no-op even if two runs ever raced.
export async function scoreDueDecisions(
  db: Database,
  asOfSession: string,
  options: ScoreDecisionsOptions = {},
): Promise<ScoreDecisionsOutcome> {
  const now = options.now ?? Date.now;
  const scoringEngine = options.engine ?? realEngine;

  const userIds = await dueDecisionUserIds(db, asOfSession);

  let usersScored = 0;
  let usersSkipped = 0;
  let decisionsScored = 0;
  let decisionsSkipped = 0;
  const errors: string[] = [];

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

        const built = await buildScoreInput(db, scopedUser, row);
        if (!built.ok) {
          decisionsSkipped += 1;
          errors.push(`build_failed:${built.reason}`);
          continue;
        }

        const result = await scoringEngine.score(built.input);
        if (!result.ok) {
          decisionsSkipped += 1;
          if (!RETRIABLE_ERROR_CODES.has(result.error.code)) {
            errors.push(`engine_error:${result.error.code}`);
          }
          continue;
        }

        const engineVersion = result.value.provenance.engineVersion;
        const { inserted } = await repository.insertIfAbsent(
          toNewDecisionScore(row.id, result.value, engineVersion),
        );
        if (inserted) {
          decisionsScored += 1;
          scoredAny = true;
        }
      }

      if (scoredAny) {
        usersScored += 1;
      }
    } catch {
      errors.push("scoring_failed");
    }
  }

  return { asOfSession, usersScored, usersSkipped, decisionsScored, decisionsSkipped, errors };
}
