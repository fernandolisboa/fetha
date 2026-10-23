import Decimal from "decimal.js";
import {
  decimalStringSchema,
  type DecimalString,
  type Instant,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { Candle, CorporateActionFactor, DividendYieldPoint } from "@fetha/engine";

export interface CashDistribution {
  underlying: Ticker;
  exDate: SessionDate;
  asOf: Instant;
  amount: DecimalString;
}

const YIELD_DECIMALS = 8;

export function oneYearBefore(session: SessionDate): string {
  return `${String(Number(session.slice(0, 4)) - 1)}${session.slice(4)}`;
}

// The trailing twelve-month dividend yield at each session close (docs/adr/0070): every
// distribution ex-dated after the same date one year earlier and on or before the session,
// each restated per share of the session by the split and bonus factors ex-dated after it,
// over that session's close. An underlying gets points only from its first distribution ever
// detected (`firstExDates`, not the first one loaded, so the points never depend on how far
// back a view reaches): before it the engine's own `dividend_yield_defaulted` (q = 0) is the
// same number, and from it on a zero point is what keeps a stale positive yield from staying
// visible once every distribution has aged out of the window.
export function dividendYieldPoints(
  candles: readonly Candle[],
  distributions: readonly CashDistribution[],
  corporateActions: readonly CorporateActionFactor[],
  firstExDates: ReadonlyMap<string, SessionDate>,
): DividendYieldPoint[] {
  const distributionsByUnderlying = new Map<string, CashDistribution[]>();
  for (const distribution of distributions) {
    const group = distributionsByUnderlying.get(distribution.underlying) ?? [];
    group.push(distribution);
    distributionsByUnderlying.set(distribution.underlying, group);
  }

  const points: DividendYieldPoint[] = [];
  for (const candle of candles) {
    if (candle.timeframe !== "D1") continue;
    const firstExDate = firstExDates.get(candle.ticker);
    if (firstExDate === undefined || firstExDate > candle.session) continue;
    const close = new Decimal(candle.close);
    if (!close.gt(0)) continue;
    const own = distributionsByUnderlying.get(candle.ticker) ?? [];

    const windowStart = oneYearBefore(candle.session);
    const factors = corporateActions.filter(
      (factor) => factor.ticker === candle.ticker && factor.asOf <= candle.asOf,
    );
    let total = new Decimal(0);
    for (const distribution of own) {
      if (distribution.exDate <= windowStart || distribution.exDate > candle.session) continue;
      if (distribution.asOf > candle.asOf) continue;
      const restated = factors
        .filter((factor) => factor.exDate > distribution.exDate && factor.exDate <= candle.session)
        .reduce((amount, factor) => amount.times(factor.factor), new Decimal(distribution.amount));
      total = total.plus(restated);
    }

    points.push({
      underlying: candle.ticker,
      asOf: candle.asOf,
      annualYield: decimalStringSchema.parse(
        total.div(close).toDecimalPlaces(YIELD_DECIMALS, Decimal.ROUND_HALF_UP).toFixed(),
      ),
    });
  }
  return points;
}
