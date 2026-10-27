import { confidenceSchema, instantSchema, tickerSchema } from "@fetha/contracts";
import {
  engine as realEngine,
  type Operation,
  type Score,
  type TradingSession,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import {
  buildOperationMarketView,
  calendarUpTo,
  tradingSessionOnOrAfter,
} from "@/modules/market-data";

import { dueResearchUserIds } from "./due-research-users";
import {
  ResearchScoresRepository,
  type DueResearchIdea,
  type NewResearchIdeaScore,
} from "./research-scores-repository";
import {
  insufficientDataExhausted,
  RETRIABLE_ERROR_CODE,
  type ScoreDecisionsOptions,
} from "./scoring-service";

// An idea states its claim without a likelihood (docs/adr/0076, as a suggestion does, ADR-0067):
// the engine scores it as a certain call, so the journal reads its hit rate and P&L, never a
// Brier.
const ASSERTED = confidenceSchema.parse("1");

export interface ScoreResearchOutcome {
  asOfSession: string;
  scored: number;
  skipped: number;
  errors: number;
}

function emptyOutcome(asOfSession = "", errors = 0): ScoreResearchOutcome {
  return { asOfSession, scored: 0, skipped: 0, errors };
}

function operationOf(idea: DueResearchIdea): Operation {
  return {
    id: `research-score:${idea.id}`,
    underlying: tickerSchema.parse(idea.underlying),
    legs: idea.legs,
    expiry: idea.horizon,
    openedAt: idea.newestClose,
    strategyVersionId: null,
    rolledFrom: null,
  };
}

function scoredRow(ideaId: string, score: Score): NewResearchIdeaScore {
  return {
    ideaId,
    score,
    claimHeld: score.thesis.claim === null ? null : score.thesis.held,
    pnlCentavos: score.pnl,
    maxLossCentavos: score.maxLoss === null || score.maxLoss === "unbounded" ? null : score.maxLoss,
    normalizedPnl: score.normalizedPnl,
    engineVersion: score.provenance.engineVersion,
  };
}

// The nightly step after suggestion scoring (docs/adr/0076): on the same as-of session the
// decisions were scored on, the same deadline and retry window, scores every research idea whose horizon has arrived as the lot it priced,
// held from the research's newest close to the horizon with no fills, the B3 default cost model
// and no strategy behind it. Every verdict is scored, `do_not_enter` included. One score per idea,
// in its user's own rows.
export async function scoreDueResearch(
  db: Database,
  asOfSession: string,
  options: ScoreDecisionsOptions = {},
): Promise<ScoreResearchOutcome> {
  const now = options.now ?? Date.now;
  const scoringEngine = options.engine ?? realEngine;

  if (!asOfSession) return emptyOutcome();
  let userIds: string[];
  try {
    userIds = await dueResearchUserIds(db, asOfSession);
  } catch (error) {
    console.error("scoreDueResearch setup failed", safeDbErrorMessage(error));
    return emptyOutcome(asOfSession, 1);
  }

  const resolvedAsOf = asOfSession;
  const outcome = emptyOutcome(resolvedAsOf);
  const engineVersion = scoringEngine.capabilities().engineVersion;
  let calendar: readonly TradingSession[] | null = null;
  async function calendarForRun(): Promise<readonly TradingSession[]> {
    calendar ??= await calendarUpTo(db, new Date(`${resolvedAsOf}T23:59:59.999Z`));
    return calendar;
  }

  for (const userId of userIds) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) {
      outcome.skipped += 1;
      continue;
    }
    try {
      const repository = new ResearchScoresRepository(db, { id: userId });
      const unscorable = (ideaId: string, reason: string) =>
        repository.insertIfAbsent({ ideaId, unscorableReason: reason, engineVersion });

      for (const idea of await repository.dueForUser(resolvedAsOf)) {
        if (options.deadlineAt !== undefined && now() >= options.deadlineAt) break;
        try {
          const [horizon, entry] = await Promise.all([
            tradingSessionOnOrAfter(db, idea.horizon),
            tradingSessionOnOrAfter(db, idea.newestClose),
          ]);
          if (!horizon || !entry) {
            outcome.errors += 1;
            await unscorable(idea.id, "unresolvable_horizon");
            continue;
          }
          if (horizon.date > resolvedAsOf) {
            outcome.skipped += 1;
            continue;
          }
          const decidedAt = instantSchema.parse(new Date(entry.close).toISOString());
          const operation = operationOf(idea);
          const view = await buildOperationMarketView(db, operation.underlying, horizon.close, {
            from: decidedAt,
          });
          const result = await scoringEngine.score({
            view,
            subject: "enter",
            decidedAt,
            horizon: horizon.date,
            confidence: ASSERTED,
            claim: idea.claim,
            operation,
            realizedFills: [],
            origin: { kind: "manual" },
            costModel: DEFAULT_COST_MODEL,
          });
          if (result.ok) {
            const { inserted } = await repository.insertIfAbsent(scoredRow(idea.id, result.value));
            if (inserted) outcome.scored += 1;
            continue;
          }
          outcome.skipped += 1;
          if (result.error.code === RETRIABLE_ERROR_CODE) {
            if (insufficientDataExhausted(await calendarForRun(), horizon.date)) {
              outcome.errors += 1;
              await unscorable(idea.id, RETRIABLE_ERROR_CODE);
            }
            continue;
          }
          outcome.errors += 1;
          await unscorable(idea.id, `engine_error:${result.error.code}`);
        } catch (error) {
          console.error("scoreDueResearch failed for an idea", safeDbErrorMessage(error));
          outcome.skipped += 1;
          outcome.errors += 1;
        }
      }
    } catch (error) {
      console.error("scoreDueResearch failed for a user", safeDbErrorMessage(error));
      outcome.errors += 1;
    }
  }
  return outcome;
}
