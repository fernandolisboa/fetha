import Decimal from "decimal.js";
import fc from "fast-check";
import type { DecimalString } from "@fetha/contracts";
import type { Candle } from "../api";

const decimalString = (value: string): DecimalString => value as DecimalString;

const sessionAt = (index: number): string => {
  const d = new Date(Date.UTC(2024, 0, 1 + index));
  return d.toISOString().slice(0, 10);
};

export const candlePriceArbitrary = fc
  .integer({ min: 100, max: 100_000 })
  .map((cents) => decimalString((cents / 100).toFixed(2)));

const ohlcArbitrary = fc
  .tuple(
    candlePriceArbitrary,
    candlePriceArbitrary,
    fc.integer({ min: 0, max: 500 }),
    fc.integer({ min: 0, max: 500 }),
  )
  .map(([open, close, highExtraCents, lowExtraCents]) => {
    const openD = new Decimal(open);
    const closeD = new Decimal(close);
    const highExtra = new Decimal(highExtraCents).div(100);
    const lowExtra = new Decimal(lowExtraCents).div(100);
    const high = Decimal.max(openD, closeD).add(highExtra);
    const rawLow = Decimal.min(openD, closeD).sub(lowExtra);
    const low = rawLow.lte(0) ? new Decimal("0.01") : rawLow;
    return {
      open,
      close,
      high: decimalString(high.toFixed(2)),
      low: decimalString(low.toFixed(2)),
    };
  });

export const candleSeriesArbitrary: fc.Arbitrary<Candle[]> = fc
  .array(ohlcArbitrary, { minLength: 5, maxLength: 20 })
  .map((ohlcs) =>
    ohlcs.map((ohlc, i) => {
      const session = sessionAt(i);
      const candle: Candle = {
        ticker: "PETR4",
        timeframe: "D1",
        session,
        asOf: `${session}T21:00:00.000Z`,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        tradedQuantity: 1000 + i,
      };
      return candle;
    }),
  );
