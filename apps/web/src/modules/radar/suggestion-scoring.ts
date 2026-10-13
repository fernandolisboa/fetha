import { confidenceSchema, instantSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import {
  engine as realEngine,
  type Engine,
  type Operation,
  type OperationLeg,
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

import {
  dueSuggestions,
  insertSuggestionScore,
  type NewSuggestionScore,
  type StoredSuggestion,
} from "./suggestions-repository";

// A suggestion states its claim without a likelihood (docs/adr/0067), so the engine scores it as
// a certain call: its Brier is 0 when the claim held and 1 when it did not, the miss rate. The
// journal shows the hit rate and the P&L, never this Brier.
const ASSERTED = confidenceSchema.parse("1");
// The same retry window decisions and analyses use (ADR-0014 Q54): missing data this many
// sessions after the horizon is a permanent gap.
const INSUFFICIENT_DATA_RETRY_SESSIONS = 5;

export interface ScoreSuggestionsOutcome {
  asOfSession: string;
  scored: number;
  skipped: number;
  errors: number;
}

export interface ScoreSuggestionsOptions {
  deadlineAt?: number;
  now?: () => number;
  engine?: Pick<Engine, "score" | "capabilities">;
}

// The lot the suggestion priced, entered at the engine's own leg prices at the scanned close.
function operationOf(suggestion: StoredSuggestion): Operation | null {
  const legs: OperationLeg[] = [];
  for (const [index, leg] of suggestion.legs.entries()) {
    const price = suggestion.pricing.legs[index]?.price ?? null;
    if (price === null || suggestion.pricing.legs[index]?.leg.ticker !== leg.ticker) return null;
    legs.push({ ...leg, entryPrice: price });
  }
  return {
    id: `suggestion-score:${suggestion.id}`,
    underlying: tickerSchema.parse(suggestion.underlying),
    legs,
    expiry: suggestion.horizon,
    openedAt: suggestion.session,
    strategyVersionId: null,
    rolledFrom: null,
  };
}

function scoredRow(suggestionId: string, score: Score): NewSuggestionScore {
  return {
    suggestionId,
    score,
    claimHeld: score.thesis.claim === null ? null : score.thesis.held,
    pnlCentavos: score.pnl,
    maxLossCentavos: score.maxLoss === null || score.maxLoss === "unbounded" ? null : score.maxLoss,
    normalizedPnl: score.normalizedPnl,
    engineVersion: score.provenance.engineVersion,
  };
}

// The nightly step after decisions and analyses (docs/adr/0067): scores, on the same as-of session
// and deadline, every suggestion whose horizon has arrived, as the operation it priced held from
// the scanned close to the horizon with no fills, the B3 default cost model and no strategy
// behind it. Reference data: one score per suggestion, for every user.
export async function scoreDueSuggestions(
  db: Database,
  asOfSession: string,
  options: ScoreSuggestionsOptions = {},
): Promise<ScoreSuggestionsOutcome> {
  const now = options.now ?? Date.now;
  const scoringEngine = options.engine ?? realEngine;
  const outcome: ScoreSuggestionsOutcome = { asOfSession, scored: 0, skipped: 0, errors: 0 };
  const asOf = sessionDateSchema.safeParse(asOfSession);
  if (!asOf.success) return outcome;

  let due: StoredSuggestion[];
  let calendar: readonly TradingSession[];
  try {
    due = await dueSuggestions(db, asOf.data);
    calendar = due.length > 0 ? await calendarUpTo(db, new Date(`${asOf.data}T23:59:59.999Z`)) : [];
  } catch (error) {
    console.error("scoreDueSuggestions setup failed", safeDbErrorMessage(error));
    return { ...outcome, errors: 1 };
  }
  const engineVersion = scoringEngine.capabilities().engineVersion;
  const unscorable = (suggestionId: string, reason: string) =>
    insertSuggestionScore(db, { suggestionId, unscorableReason: reason, engineVersion });

  for (const suggestion of due) {
    if (options.deadlineAt !== undefined && now() >= options.deadlineAt) break;
    try {
      const operation = operationOf(suggestion);
      const horizon = await tradingSessionOnOrAfter(db, suggestion.horizon);
      if (!operation || !horizon) {
        outcome.errors += 1;
        await unscorable(suggestion.id, operation ? "unresolvable_horizon" : "missing_entry_price");
        continue;
      }
      if (horizon.date > asOf.data) {
        outcome.skipped += 1;
        continue;
      }
      const decidedAt = instantSchema.parse(suggestion.asOf.toISOString());
      const view = await buildOperationMarketView(db, operation.underlying, horizon.close, {
        from: decidedAt,
      });
      const result = await scoringEngine.score({
        view,
        subject: "enter",
        decidedAt,
        horizon: horizon.date,
        confidence: ASSERTED,
        claim: suggestion.claim,
        operation,
        realizedFills: [],
        origin: { kind: "manual" },
        costModel: DEFAULT_COST_MODEL,
      });
      if (result.ok) {
        const { inserted } = await insertSuggestionScore(
          db,
          scoredRow(suggestion.id, result.value),
        );
        if (inserted) outcome.scored += 1;
        continue;
      }
      outcome.skipped += 1;
      if (result.error.code === "insufficient_data") {
        const since = calendar.filter((session) => session.date > horizon.date).length;
        if (since >= INSUFFICIENT_DATA_RETRY_SESSIONS) {
          outcome.errors += 1;
          await unscorable(suggestion.id, "insufficient_data");
        }
        continue;
      }
      outcome.errors += 1;
      await unscorable(suggestion.id, `engine_error:${result.error.code}`);
    } catch (error) {
      console.error("scoreDueSuggestions failed for a suggestion", safeDbErrorMessage(error));
      outcome.skipped += 1;
      outcome.errors += 1;
    }
  }
  return outcome;
}
