import Decimal from "decimal.js";
import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { OptionRight, OptionSeries } from "@fetha/engine";

// The leg-by-leg roll rule (#382, ADR-0080 addendum "roll by leg, never by inferred structure"):
// one shared next monthly expiry for the whole roll (so a multi-leg structure never splits
// across two expiries), then for each leg the nearest strike to its own held strike at that
// expiry. Ties (two series equally close) resolve to the lower strike, deterministic rather than
// picking whichever the chain happened to list first.
export interface RollExpiryTarget {
  underlying: Ticker;
  currentExpiry: SessionDate;
}

export type RollExpirySelection =
  { ok: true; expiry: SessionDate } | { ok: false; reason: "no_next_expiry" };

// Picks the shared next monthly expiry from the full monthly chain (`monthlySeries`, expected
// already narrowed by market-data/monthly-expiry.ts's `filterToMonthlyExpiries` but not yet by
// `filterToTradedSeries`), so an expiry with no traded series yet still counts as "next" and
// `no_traded_series` stays reachable as its own, later refusal (#382 review advisory).
export function selectNextMonthlyExpiry(
  monthlySeries: readonly OptionSeries[],
  target: RollExpiryTarget,
): RollExpirySelection {
  const laterExpiries = [
    ...new Set(
      monthlySeries
        .filter((series) => series.underlying === target.underlying)
        .map((series) => series.expiry)
        .filter((expiry) => expiry > target.currentExpiry),
    ),
  ].sort();
  const nextExpiry = laterExpiries[0];
  if (nextExpiry === undefined) {
    return { ok: false, reason: "no_next_expiry" };
  }
  return { ok: true, expiry: nextExpiry };
}

export interface RollStrikeTarget {
  underlying: Ticker;
  right: OptionRight;
  expiry: SessionDate;
  currentStrike: DecimalString;
}

export type RollStrikeSelection =
  { ok: true; series: OptionSeries } | { ok: false; reason: "no_traded_series" };

// Picks the nearest-strike series for one leg at the already-chosen shared expiry, among series
// expected narrowed to traded ones (`tradedSeries`, market-data/traded-series.ts's
// `filterToTradedSeries`). This module never decides what counts as tradeable or monthly itself,
// nor which expiry to roll to; it only picks among what it is given.
export function selectNearestStrikeAtExpiry(
  tradedSeries: readonly OptionSeries[],
  target: RollStrikeTarget,
): RollStrikeSelection {
  const candidates = tradedSeries.filter(
    (series) =>
      series.underlying === target.underlying &&
      series.right === target.right &&
      series.expiry === target.expiry,
  );
  if (candidates.length === 0) {
    return { ok: false, reason: "no_traded_series" };
  }
  const currentStrike = new Decimal(target.currentStrike);
  const nearest = candidates.reduce((best, candidate) => {
    const bestDistance = new Decimal(best.strike).minus(currentStrike).abs();
    const candidateDistance = new Decimal(candidate.strike).minus(currentStrike).abs();
    if (candidateDistance.lessThan(bestDistance)) return candidate;
    if (candidateDistance.equals(bestDistance)) {
      return new Decimal(candidate.strike).lessThan(new Decimal(best.strike)) ? candidate : best;
    }
    return best;
  });
  return { ok: true, series: nearest };
}
