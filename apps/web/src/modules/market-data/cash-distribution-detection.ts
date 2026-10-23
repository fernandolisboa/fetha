import Decimal from "decimal.js";
import { decimalStringSchema, type DecimalString, type Ticker } from "@fetha/contracts";

export interface StrikeTransition {
  underlying: Ticker;
  previousStrike: DecimalString;
  strike: DecimalString;
}

export interface DetectedCashDistribution {
  underlying: Ticker;
  amount: DecimalString;
  seriesCount: number;
}

// B3 lowers every listed option strike of an underlying by a cash distribution's amount on
// its ex-date, so the drop is the same in reais across strikes; a split or a bonus scales
// strikes instead, and its drops differ from strike to strike (docs/adr/0070). Two distinct
// previous strikes are the least that can tell the two apart; 90% agreement tolerates a
// stray series re-registered on the same session.
const MIN_DISTINCT_STRIKES = 2;
const MIN_AGREEING_NUMERATOR = 9;
const MIN_AGREEING_DENOMINATOR = 10;

export function detectCashDistributions(
  transitions: readonly StrikeTransition[],
  excludedUnderlyings: ReadonlySet<string> = new Set(),
): DetectedCashDistribution[] {
  const byUnderlying = new Map<Ticker, StrikeTransition[]>();
  for (const transition of transitions) {
    if (excludedUnderlyings.has(transition.underlying)) continue;
    const group = byUnderlying.get(transition.underlying) ?? [];
    group.push(transition);
    byUnderlying.set(transition.underlying, group);
  }

  const detected: DetectedCashDistribution[] = [];
  for (const [underlying, group] of [...byUnderlying].sort(([a], [b]) => a.localeCompare(b))) {
    const distinctStrikes = new Set(group.map((t) => new Decimal(t.previousStrike).toFixed()));
    if (distinctStrikes.size < MIN_DISTINCT_STRIKES) continue;

    const countByDrop = new Map<string, number>();
    for (const transition of group) {
      const drop = new Decimal(transition.previousStrike).minus(transition.strike).toFixed();
      countByDrop.set(drop, (countByDrop.get(drop) ?? 0) + 1);
    }
    const [drop, agreeing] = [...countByDrop].reduce((best, entry) =>
      entry[1] > best[1] ? entry : best,
    );
    if (agreeing * MIN_AGREEING_DENOMINATOR < group.length * MIN_AGREEING_NUMERATOR) continue;
    if (!new Decimal(drop).gt(0)) continue;

    detected.push({
      underlying,
      amount: decimalStringSchema.parse(drop),
      seriesCount: agreeing,
    });
  }
  return detected;
}
