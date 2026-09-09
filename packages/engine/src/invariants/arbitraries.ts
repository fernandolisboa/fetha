import fc from "fast-check";
import type { Candle } from "../api";
import { decimalString } from "../internal/test-support";

const sessionAt = (index: number): string => {
  const d = new Date(Date.UTC(2024, 0, 1 + index));
  return d.toISOString().slice(0, 10);
};

export const candlePriceArbitrary = fc
  .integer({ min: 100, max: 100_000 })
  .map((cents) => decimalString((cents / 100).toFixed(2)));

export const candleSeriesArbitrary: fc.Arbitrary<Candle[]> = fc
  .array(candlePriceArbitrary, { minLength: 5, maxLength: 20 })
  .map((closes) =>
    closes.map((close, i) => {
      const session = sessionAt(i);
      const candle: Candle = {
        ticker: "PETR4",
        timeframe: "D1",
        session,
        asOf: `${session}T21:00:00.000Z`,
        open: close,
        high: close,
        low: close,
        close,
        tradedQuantity: 1000 + i,
      };
      return candle;
    }),
  );
