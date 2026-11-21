import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { LegInput, MarketView, OptionRight, OptionSeries } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  buildOperationMarketView,
  filterToMonthlyExpiries,
  filterToTradedSeries,
  latestCandle,
  tradingSessionForDate,
} from "@/modules/market-data";

import { getMyHeldOperation, HeldOperationNotFoundError } from "../held-operations";
import { planRollLegs, type HeldLegFacts } from "./roll-plan";

export interface ResolvedRollLeg {
  ticker: Ticker;
  right: OptionRight;
  currentStrike: DecimalString;
  closingLeg: LegInput;
  openingLeg: LegInput;
  targetSeries: OptionSeries;
}

export type RollResolveOutcome =
  | {
      ok: true;
      operationId: string;
      underlying: Ticker;
      expiry: SessionDate;
      fillIds: string[];
      view: MarketView;
      at: Instant;
      sessionDate: SessionDate;
      legs: ResolvedRollLeg[];
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "no_option_legs"
        | "no_expiry"
        | "no_data"
        | "no_next_expiry"
        | "no_traded_series";
      ticker?: Ticker;
    };

// The session every roll is priced at (#382, the same anchor `plans/actions.ts`'s own
// `resolvePricingSessionFor` resolves by): the newest session this underlying actually has an
// ingested daily candle for, not merely the newest closed calendar session, so a roll never marks
// a leg stale against a close nothing was ever priced at.
async function resolvePricingSessionFor(
  underlying: Ticker,
): Promise<{ date: SessionDate; at: Instant } | null> {
  const candle = await latestCandle(getDb(), underlying);
  if (!candle) return null;
  const trading = await tradingSessionForDate(getDb(), candle.session);
  if (!trading) return null;
  return { date: trading.date, at: trading.close };
}

// The held leg's own right and strike, read from the view's raw (unfiltered) option series
// rather than inferred from the structure (#382: roll leg by leg, never by inferred structure).
// `asOf <= at` and "latest wins" mirrors `plans/actions.ts`'s own `seriesFactsOf`.
function heldLegFactsOf(
  optionSeries: readonly OptionSeries[],
  ticker: Ticker,
  at: Instant,
): Pick<OptionSeries, "right" | "strike"> | null {
  return optionSeries
    .filter((series) => series.ticker === ticker && series.asOf <= at)
    .reduce<OptionSeries | null>(
      (latest, candidate) => (!latest || candidate.asOf > latest.asOf ? candidate : latest),
      null,
    );
}

// Resolves everything a roll needs for one open operation (#382): the held option legs' own
// series facts, the next monthly expiry's nearest-strike series for each of them
// (`roll-plan.ts`), and the market view both pricing calls share. Recomputed from scratch on
// every call, including a record action's own re-check, so nothing about a roll is ever only
// client-trusted (CLAUDE.md principle 1). A stock leg (a covered call's own stock) is left out of
// the roll entirely: nothing to roll for it.
export async function resolveRoll(operationId: string): Promise<RollResolveOutcome> {
  let held;
  try {
    held = await getMyHeldOperation(operationId);
  } catch (error) {
    if (error instanceof HeldOperationNotFoundError) {
      return { ok: false, reason: "not_found" };
    }
    throw error;
  }

  const optionLegs = held.legs.filter((leg) => leg.role !== "stock");
  if (optionLegs.length === 0) {
    return { ok: false, reason: "no_option_legs" };
  }
  if (!held.expiry) {
    return { ok: false, reason: "no_expiry" };
  }

  const session = await resolvePricingSessionFor(held.underlying);
  if (!session) {
    return { ok: false, reason: "no_data" };
  }

  const rawView = await buildOperationMarketView(getDb(), held.underlying, session.at);
  const legsFacts: HeldLegFacts[] = [];
  for (const leg of optionLegs) {
    const facts = heldLegFactsOf(rawView.optionSeries, leg.ticker, session.at);
    if (!facts) {
      return { ok: false, reason: "no_data" };
    }
    legsFacts.push({ leg, right: facts.right, strike: facts.strike });
  }

  const candidateView = filterToTradedSeries(filterToMonthlyExpiries(rawView), session.date);
  const results = planRollLegs(held.underlying, held.expiry, legsFacts, candidateView.optionSeries);
  const failed = results.find(
    (result): result is Extract<(typeof results)[number], { ok: false }> => !result.ok,
  );
  if (failed) {
    return { ok: false, reason: failed.reason, ticker: failed.ticker };
  }

  return {
    ok: true,
    operationId,
    underlying: held.underlying,
    expiry: held.expiry,
    fillIds: held.fillIds,
    // The raw (unfiltered) view, not `candidateView`: pricing the closing legs needs the held
    // series' own facts, which the monthly/traded filters (meant only to narrow which series
    // `selectNextMonthlySeries` may pick among) can drop, e.g. a held series no longer trading.
    view: rawView,
    at: session.at,
    sessionDate: session.date,
    legs: results.flatMap((result, index) => {
      if (!result.ok) return [];
      const facts = legsFacts[index];
      if (!facts) return [];
      return [
        {
          ticker: result.openingLeg.ticker,
          right: facts.right,
          currentStrike: facts.strike,
          closingLeg: result.closingLeg,
          openingLeg: result.openingLeg,
          targetSeries: result.targetSeries,
        },
      ];
    }),
  };
}
