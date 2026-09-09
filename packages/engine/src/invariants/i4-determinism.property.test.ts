import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { IndicatorsInput } from "../api";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { candleSeriesArbitrary } from "./arbitraries";

describe("I4 Determinism", () => {
  it("identical inputs yield deep-equal, byte-identical JSON artifacts", () => {
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        const lastCandle = assertDefined(candles.at(-1), "test setup: missing last candle");
        const input: IndicatorsInput = {
          view: {
            calendar: [],
            candles,
            corporateActions: [],
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [],
            dividendYields: [],
            impliedVolatilityIndex: [],
          },
          ticker: "PETR4",
          timeframe: "D1",
          indicators: [
            { kind: "sma", length: 3 },
            { kind: "rsi", length: 3 },
          ],
          at: lastCandle.asOf,
        };
        const first = computeIndicators(input);
        const second = computeIndicators(JSON.parse(JSON.stringify(input)) as IndicatorsInput);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
    );
  });
});
