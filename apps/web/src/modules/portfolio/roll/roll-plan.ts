import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { Leg, LegInput, OptionRight, OptionSeries, Side } from "@fetha/engine";

import { selectNextMonthlySeries } from "./roll-series-selection";

// One held leg, with the series facts the ticket's own leg-by-leg rule needs (#382, ADR-0080
// addendum "roll by leg, never by inferred structure"): `leg` carries the role/side/quantity the
// opening order keeps, `right`/`strike` are read from the held series, never inferred from the
// structure the operation happens to look like.
export interface HeldLegFacts {
  leg: Leg;
  right: OptionRight;
  strike: DecimalString;
}

export type RollLegPlan =
  | { ok: true; closingLeg: LegInput; openingLeg: LegInput; targetSeries: OptionSeries }
  | { ok: false; ticker: Ticker; reason: "no_next_expiry" | "no_traded_series" };

function oppositeSide(side: Side): Side {
  return side === "buy" ? "sell" : "buy";
}

// The leg-by-leg roll plan (#382): each held option leg closes with its side reversed (closing a
// short is a buy, closing a long is a sell) and reopens at the next monthly expiry's nearest
// strike (`roll-series-selection.ts`'s `selectNextMonthlySeries`), same role, same side and
// quantity as the leg being closed. One leg's failure (no next expiry, or no traded series at it)
// never blocks another leg's own plan: the caller decides whether any failure refuses the whole
// roll.
export function planRollLegs(
  underlying: Ticker,
  currentExpiry: SessionDate,
  legs: readonly HeldLegFacts[],
  optionSeries: readonly OptionSeries[],
): RollLegPlan[] {
  return legs.map(({ leg, right, strike }) => {
    const selection = selectNextMonthlySeries(optionSeries, {
      underlying,
      right,
      currentExpiry,
      currentStrike: strike,
    });
    if (!selection.ok) {
      return { ok: false, ticker: leg.ticker, reason: selection.reason };
    }
    return {
      ok: true,
      closingLeg: {
        role: leg.role,
        side: oppositeSide(leg.side),
        ticker: leg.ticker,
        quantity: leg.quantity,
      },
      openingLeg: {
        role: right,
        side: leg.side,
        ticker: selection.series.ticker,
        quantity: leg.quantity,
      },
      targetSeries: selection.series,
    };
  });
}
