import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { EngineError, MarketView, OptionSeries } from "../api";
import { PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { isAtOrBefore } from "./instant";
import { codeUnitCompare } from "./order";
import { resolveSeries } from "./resolve-series";
import { splitFactorProduct } from "./split-factor";

export type ResolvedOptionStrike = {
  series: OptionSeries;
  strike: DecimalString;
  derived: boolean;
};

export type ResolveOptionStrikeResult =
  { ok: true; value: ResolvedOptionStrike } | { ok: false; error: EngineError };

// Mirrors evaluateStrategy's own sessionForInstant: the last calendar session whose open is at
// or before `at`, falling back to slicing the instant's own date when the view carries no
// calendar row to anchor it (ADR-0013 "asOf is the candle close for candles").
function sessionOf(calendar: MarketView["calendar"], at: Instant): SessionDate {
  let found: SessionDate | null = null;
  const sorted = [...calendar].sort((a, b) => codeUnitCompare(a.date, b.date));
  for (const session of sorted) {
    if (isAtOrBefore(session.open, at)) found = session.date;
    else break;
  }
  return found ?? at.slice(0, 10);
}

// An option leg's strike at an instant (#69 part 2, ADR-0013 addendum): the latest visible
// epoch for its ticker (`resolveSeries`), which already carries B3's own re-struck strike once a
// new epoch has been ingested for a corporate action. When no epoch yet reflects a corporate
// action visible by `at` — a data gap between the action's own `asOf` and the next ingested
// epoch, not a modeling choice — this derives the strike itself: the epoch's own strike times
// the product of every factor of `underlying` with an exDate strictly after that epoch's own
// session and at or before `atSession`, rounded half-up to the cent (B3's own rounding on a
// split-adjusted strike, e.g. 27.19 x 0.5 = 13.595 -> 13.60). `atSession` is `null` only when the
// caller has no calendar session to anchor the derivation to; derivation is then skipped and the
// epoch's own strike is returned unchanged, matching the engine's pre-#69 behavior for that case.
export function resolveOptionStrike(
  view: MarketView,
  ticker: Ticker,
  underlying: Ticker,
  atSession: SessionDate | null,
  at: Instant,
): ResolveOptionStrikeResult {
  const series = resolveSeries(view, ticker, at);
  if (!series) return { ok: false, error: { code: "missing_instrument", ticker } };

  if (atSession === null) {
    return { ok: true, value: { series, strike: series.strike, derived: false } };
  }

  const seriesSession = sessionOf(view.calendar, series.asOf);
  const visibleFactors = view.corporateActions.filter(
    (f) => f.ticker === underlying && isAtOrBefore(f.asOf, at),
  );
  const factorResult = splitFactorProduct(visibleFactors, seriesSession, atSession);
  if (!factorResult.ok) return { ok: false, error: factorResult.error };

  if (factorResult.value.eq(1)) {
    return { ok: true, value: { series, strike: series.strike, derived: false } };
  }

  const derivedStrike = parseDecimal(series.strike).mul(factorResult.value);
  return {
    ok: true,
    value: {
      series,
      strike: toDecimalString(derivedStrike, PRICE_SCALE),
      derived: true,
    },
  };
}
