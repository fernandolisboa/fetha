import Decimal from "decimal.js";
import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { OptionRight, OptionSeries } from "@fetha/engine";

// The leg-by-leg roll rule (#382, ADR-0080 addendum "roll by leg, never by inferred structure"):
// the next monthly expiry after the held leg's own expiry, same right, nearest strike to the
// held leg's own strike. Ties (two series equally close) resolve to the lower strike,
// deterministic rather than picking whichever the chain happened to list first.
export interface RollSeriesTarget {
  underlying: Ticker;
  right: OptionRight;
  currentExpiry: SessionDate;
  currentStrike: DecimalString;
}

export type RollSeriesSelection =
  { ok: true; series: OptionSeries } | { ok: false; reason: "no_next_expiry" | "no_traded_series" };

// `optionSeries` is expected already narrowed to series that traded at the pricing session
// (plans/traded-series.ts's `filterToTradedSeries`) and to monthly expiries
// (plans/monthly-expiry.ts's `filterToMonthlyExpiries`): this module only picks among what it is
// given, it never decides what counts as tradeable or monthly itself.
export function selectNextMonthlySeries(
  optionSeries: readonly OptionSeries[],
  target: RollSeriesTarget,
): RollSeriesSelection {
  const sameUnderlyingAndRight = optionSeries.filter(
    (series) => series.underlying === target.underlying && series.right === target.right,
  );
  const laterExpiries = [
    ...new Set(
      sameUnderlyingAndRight
        .map((series) => series.expiry)
        .filter((expiry) => expiry > target.currentExpiry),
    ),
  ].sort();
  const nextExpiry = laterExpiries[0];
  if (nextExpiry === undefined) {
    return { ok: false, reason: "no_next_expiry" };
  }
  const candidates = sameUnderlyingAndRight.filter((series) => series.expiry === nextExpiry);
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
