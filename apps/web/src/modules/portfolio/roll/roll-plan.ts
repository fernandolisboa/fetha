import Decimal from "decimal.js";
import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { Leg, LegInput, OptionRight, OptionSeries, Side } from "@fetha/engine";

import { selectNearestStrikeAtExpiry, selectNextMonthlyExpiry } from "./roll-series-selection";

// One held leg, with the series facts the ticket's own leg-by-leg rule needs (#382, ADR-0080,
// "roll by leg, never by inferred structure"): `leg` carries the role/side/quantity the
// opening order keeps, `right`/`strike` are read from the held series, never inferred from the
// structure the operation happens to look like.
export interface HeldLegFacts {
  leg: Leg;
  right: OptionRight;
  strike: DecimalString;
}

export interface RollLegPlan {
  leg: Leg;
  right: OptionRight;
  currentStrike: DecimalString;
  closingLeg: LegInput;
  openingLeg: LegInput;
  targetSeries: OptionSeries;
}

export type RollPlanOutcome =
  | { ok: true; expiry: SessionDate; legs: RollLegPlan[] }
  | { ok: false; reason: "no_next_expiry" }
  | { ok: false; reason: "no_traded_series"; ticker: Ticker }
  | { ok: false; reason: "duplicate_ticker"; ticker: Ticker }
  | { ok: false; reason: "strike_width_changed" };

function oppositeSide(side: Side): Side {
  return side === "buy" ? "sell" : "buy";
}

function consecutiveWidths(strikes: readonly DecimalString[]): Decimal[] {
  const widths: Decimal[] = [];
  for (let index = 1; index < strikes.length; index += 1) {
    const previous = strikes[index - 1];
    const current = strikes[index];
    if (previous === undefined || current === undefined) continue;
    widths.push(new Decimal(current).minus(new Decimal(previous)));
  }
  return widths;
}

// The leg-by-leg roll plan (#382, ADR-0080): one shared next monthly expiry is chosen
// for the whole operation first (`roll-series-selection.ts`'s `selectNextMonthlyExpiry`), so a
// strangle or collar's legs never land on two different expiries; only then does each leg pick
// its own nearest strike at that expiry. Each held option leg closes with its side reversed
// (closing a short is a buy, closing a long is a sell) and reopens same role, same side and
// quantity as the leg being closed. The plan refuses as a whole, rather than leg by leg, when two
// legs would resolve to the same ticker or when the strike width between legs changes: either
// would silently turn the structure the user holds into a different one.
export function planRoll(
  underlying: Ticker,
  currentExpiry: SessionDate,
  legs: readonly HeldLegFacts[],
  monthlySeries: readonly OptionSeries[],
  tradedSeries: readonly OptionSeries[],
  at: Instant,
): RollPlanOutcome {
  const expirySelection = selectNextMonthlyExpiry(monthlySeries, { underlying, currentExpiry });
  if (!expirySelection.ok) {
    return { ok: false, reason: "no_next_expiry" };
  }
  const expiry = expirySelection.expiry;

  const results: RollLegPlan[] = [];
  for (const { leg, right, strike } of legs) {
    const selection = selectNearestStrikeAtExpiry(tradedSeries, {
      underlying,
      right,
      expiry,
      currentStrike: strike,
      at,
    });
    if (!selection.ok) {
      return { ok: false, reason: "no_traded_series", ticker: leg.ticker };
    }
    results.push({
      leg,
      right,
      currentStrike: strike,
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
    });
  }

  const openingTickers = results.map((result) => result.openingLeg.ticker);
  const duplicate = openingTickers.find(
    (ticker, index) => openingTickers.indexOf(ticker) !== index,
  );
  if (duplicate !== undefined) {
    return { ok: false, reason: "duplicate_ticker", ticker: duplicate };
  }

  const currentWidths = consecutiveWidths(legs.map((leg) => leg.strike));
  const targetWidths = consecutiveWidths(results.map((result) => result.targetSeries.strike));
  const widthChanged = currentWidths.some((width, index) => {
    const targetWidth = targetWidths[index];
    return targetWidth === undefined || !width.equals(targetWidth);
  });
  if (widthChanged) {
    return { ok: false, reason: "strike_width_changed" };
  }

  return { ok: true, expiry, legs: results };
}
