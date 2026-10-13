import { engine as realEngine, type ScoreInput, type TradingSession } from "@fetha/engine";
import { instantSchema } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import {
  buildOperationMarketView,
  calendarUpTo,
  tradingSessionOnOrAfter,
} from "@/modules/market-data";

import { AnalysisScoresRepository, type DueAnalysisRow } from "./analysis-scores-repository";
import { dueAnalysisUserIds } from "./due-analysis-users";
import {
  insufficientDataExhausted,
  resolveAsOfSession,
  RETRIABLE_ERROR_CODE,
  type ScoreDecisionsOptions,
  type ScoreDueDecisionsInput,
} from "./scoring-service";

export interface ScoreAnalysesOutcome {
  asOfSession: string;
  usersScored: number;
  usersSkipped: number;
  analysesScored: number;
  analysesSkipped: number;
  errors: { requestId: string | null; kind: string }[];
}

function emptyOutcome(errors: ScoreAnalysesOutcome["errors"] = []): ScoreAnalysesOutcome {
  return {
    asOfSession: "",
    usersScored: 0,
    usersSkipped: 0,
    analysesScored: 0,
    analysesSkipped: 0,
    errors,
  };
}

// docs/adr/0058: an analysis is scored on its claim alone (ADR-0014 Q46),
// with no operation and no fills; `subject: "analysis"` and the request
// instant as `decidedAt` keep the engine's no-look-ahead check on the
// horizon close. The cost model is required by `ScoreInput` but unused
// without an operation.
async function buildAnalysisScoreInput(
  db: Database,
  row: DueAnalysisRow,
): Promise<{ ok: true; input: ScoreInput } | { ok: false; reason: string }> {
  const horizonSession = await tradingSessionOnOrAfter(db, row.horizon);
  if (!horizonSession) {
    return { ok: false, reason: "build_failed:unresolvable_horizon_session" };
  }
  const decidedAt = instantSchema.parse(row.requestedAt.toISOString());
  if (row.claim.kind === "operation_pnl_positive") {
    return { ok: false, reason: "build_failed:invalid_inputs" };
  }
  const view = await buildOperationMarketView(db, row.claim.instrument, horizonSession.close, {
    from: decidedAt,
  });
  return {
    ok: true,
    input: {
      view,
      subject: "analysis",
      decidedAt,
      horizon: horizonSession.date,
      confidence: row.confidence,
      claim: row.claim,
      realizedFills: [],
      origin: { kind: "manual" },
      costModel: DEFAULT_COST_MODEL,
    },
  };
}

// Chained after `scoreDueDecisions` in the same nightly run, with the same
// as-of session, deadline and retry rules (ADR-0014 Q54): one append-only
// `analysis_scores` row per due analysis, either the engine's score or a
// terminal unscorable reason. Error isolation is per user and per analysis,
// and nothing here fails the run's response.
export async function scoreDueAnalyses(
  db: Database,
  input: ScoreDueDecisionsInput,
  options: ScoreDecisionsOptions = {},
): Promise<ScoreAnalysesOutcome> {
  const now = options.now ?? Date.now;
  const scoringEngine = options.engine ?? realEngine;

  let asOfSession: string | undefined;
  let userIds: string[];
  try {
    asOfSession = await resolveAsOfSession(db, input);
    if (!asOfSession) {
      return emptyOutcome();
    }
    userIds = await dueAnalysisUserIds(db, asOfSession);
  } catch (error) {
    console.error("scoreDueAnalyses setup failed", safeDbErrorMessage(error));
    return emptyOutcome([{ requestId: null, kind: "setup_failed" }]);
  }

  const resolvedAsOfSession: string = asOfSession;
  const unscorableEngineVersion = scoringEngine.capabilities().engineVersion;

  let calendarUpToAsOf: readonly TradingSession[] | null = null;
  async function calendarForRun(): Promise<readonly TradingSession[]> {
    calendarUpToAsOf ??= await calendarUpTo(db, new Date(`${resolvedAsOfSession}T23:59:59.999Z`));
    return calendarUpToAsOf;
  }

  const outcome: ScoreAnalysesOutcome = { ...emptyOutcome(), asOfSession: resolvedAsOfSession };

  for (const userId of userIds) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      outcome.usersSkipped += 1;
      continue;
    }
    try {
      const repository = new AnalysisScoresRepository(db, { id: userId });
      const due = await repository.dueForUser(resolvedAsOfSession);
      let scoredAny = false;

      for (const row of due) {
        if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
          break;
        }
        try {
          const built = await buildAnalysisScoreInput(db, row);
          if (!built.ok) {
            outcome.analysesSkipped += 1;
            outcome.errors.push({ requestId: row.requestId, kind: built.reason });
            await repository.insertIfAbsent({
              requestId: row.requestId,
              unscorableReason: built.reason,
              engineVersion: unscorableEngineVersion,
            });
            continue;
          }

          const result = await scoringEngine.score(built.input);
          if (!result.ok) {
            outcome.analysesSkipped += 1;
            const retriable = result.error.code === RETRIABLE_ERROR_CODE;
            if (
              retriable &&
              !insufficientDataExhausted(await calendarForRun(), built.input.horizon)
            ) {
              continue;
            }
            const reason = retriable ? RETRIABLE_ERROR_CODE : `engine_error:${result.error.code}`;
            outcome.errors.push({
              requestId: row.requestId,
              kind: retriable ? `unscorable:${reason}` : reason,
            });
            await repository.insertIfAbsent({
              requestId: row.requestId,
              unscorableReason: reason,
              engineVersion: unscorableEngineVersion,
            });
            continue;
          }

          const thesis = result.value.thesis;
          const { inserted } = await repository.insertIfAbsent({
            requestId: row.requestId,
            score: result.value,
            claimHeld: thesis.claim === null ? null : thesis.held,
            brier: thesis.claim === null ? null : thesis.brier,
            engineVersion: result.value.provenance.engineVersion,
          });
          if (inserted) {
            outcome.analysesScored += 1;
            scoredAny = true;
          }
        } catch {
          outcome.analysesSkipped += 1;
          outcome.errors.push({ requestId: row.requestId, kind: "scoring_failed" });
        }
      }

      if (scoredAny) {
        outcome.usersScored += 1;
      }
    } catch {
      outcome.errors.push({ requestId: null, kind: "scoring_failed" });
    }
  }

  return outcome;
}
