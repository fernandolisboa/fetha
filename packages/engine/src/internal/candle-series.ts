import Decimal from "decimal.js";
import type { Instant, Ticker, Timeframe } from "@fetha/contracts";
import type { Candle, CorporateActionFactor, TruncationReport } from "../api";
import { PRICE_SCALE, toDecimalString } from "./decimal";
import { compareInstants, instantMs, isAfter } from "./instant";
import { codeUnitCompare, sortedEntries, sortUnique } from "./order";

export type BuildCandleSeriesInput = {
  candles: readonly Candle[];
  corporateActions: readonly CorporateActionFactor[];
  ticker: Ticker;
  timeframe: Timeframe;
  at: Instant;
};

export type CandleSeriesResult =
  | { ok: true; value: { nominal: Candle[]; adjusted: Candle[]; truncated: TruncationReport[] } }
  | { ok: false; error: { path: string; message: string } };

const priceFields = ["open", "high", "low", "close"] as const;

export function buildCandleSeries(input: BuildCandleSeriesInput): CandleSeriesResult {
  for (const [index, c] of input.candles.entries()) {
    for (const field of priceFields) {
      if (!isPositiveDecimal(c[field])) {
        return {
          ok: false,
          error: {
            path: `view.candles[${String(index)}].${field}`,
            message: "a candle's open, high, low and close must be strictly positive",
          },
        };
      }
    }
  }

  for (const [index, factor] of input.corporateActions.entries()) {
    if (!isPositiveDecimal(factor.factor)) {
      return {
        ok: false,
        error: {
          path: `view.corporateActions[${String(index)}].factor`,
          message: "a corporate-action factor must be strictly positive",
        },
      };
    }
  }

  const sortedCandles = sortUnique(
    input.candles,
    (c) => `${c.ticker}|${c.timeframe}|${String(instantMs(c.asOf))}`,
    (a, b) =>
      codeUnitCompare(a.ticker, b.ticker) ||
      codeUnitCompare(a.timeframe, b.timeframe) ||
      compareInstants(a.asOf, b.asOf),
  );
  if (!sortedCandles.ok) {
    return {
      ok: false,
      error: {
        path: "view.candles",
        message: `duplicate candle row for ${sortedCandles.duplicateKey}`,
      },
    };
  }

  const sortedFactors = sortUnique(
    input.corporateActions,
    (f) => `${f.ticker}|${f.exDate}`,
    (a, b) =>
      codeUnitCompare(a.ticker, b.ticker) ||
      codeUnitCompare(a.exDate, b.exDate) ||
      compareInstants(a.asOf, b.asOf),
  );
  if (!sortedFactors.ok) {
    return {
      ok: false,
      error: {
        path: "view.corporateActions",
        message: `duplicate corporate action factor for ${sortedFactors.duplicateKey}`,
      },
    };
  }

  const truncated: TruncationReport[] = [];
  const otherTickerCandleDrops = new Map<string, number>();
  const nominal: Candle[] = [];
  let afterAtDropped = 0;

  for (const c of sortedCandles.value) {
    if (c.ticker !== input.ticker) {
      otherTickerCandleDrops.set(c.ticker, (otherTickerCandleDrops.get(c.ticker) ?? 0) + 1);
      continue;
    }
    if (c.timeframe !== input.timeframe) continue;
    if (isAfter(c.asOf, input.at)) {
      afterAtDropped += 1;
      continue;
    }
    nominal.push(c);
  }

  if (afterAtDropped > 0) {
    truncated.push({
      collection: "candles",
      ticker: input.ticker,
      dropped: afterAtDropped,
      reason: "after_at",
    });
  }
  for (const [ticker, dropped] of sortedEntries(otherTickerCandleDrops)) {
    truncated.push({ collection: "candles", ticker, dropped, reason: "unreferenced_instrument" });
  }

  const otherTickerFactorDrops = new Map<string, number>();
  let afterAtFactorsDropped = 0;
  const visibleFactors: CorporateActionFactor[] = [];
  for (const f of sortedFactors.value) {
    if (f.ticker !== input.ticker) {
      otherTickerFactorDrops.set(f.ticker, (otherTickerFactorDrops.get(f.ticker) ?? 0) + 1);
      continue;
    }
    if (isAfter(f.asOf, input.at)) {
      afterAtFactorsDropped += 1;
      continue;
    }
    visibleFactors.push(f);
  }

  if (afterAtFactorsDropped > 0) {
    truncated.push({
      collection: "corporateActions",
      ticker: input.ticker,
      dropped: afterAtFactorsDropped,
      reason: "after_at",
    });
  }
  for (const [ticker, dropped] of sortedEntries(otherTickerFactorDrops)) {
    truncated.push({
      collection: "corporateActions",
      ticker,
      dropped,
      reason: "unreferenced_instrument",
    });
  }

  const adjusted = nominal.map((c) => {
    const product = visibleFactors.reduce((acc, f) => {
      if (f.exDate > c.session) return acc.mul(new Decimal(f.factor));
      return acc;
    }, new Decimal(1));
    if (product.equals(1)) return c;
    const adjustedFields = Object.fromEntries(
      priceFields.map((field) => [
        field,
        toDecimalString(new Decimal(c[field]).mul(product), PRICE_SCALE),
      ]),
    );
    return { ...c, ...adjustedFields };
  });

  return { ok: true, value: { nominal, adjusted, truncated } };
}

function isPositiveDecimal(value: string): boolean {
  return new Decimal(value).isPositive() && !new Decimal(value).isZero();
}
