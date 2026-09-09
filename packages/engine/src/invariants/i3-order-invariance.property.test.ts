import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { IndicatorsInput } from "../api";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { candleSeriesArbitrary } from "./arbitraries";

const shuffle = <T>(rows: readonly T[], seed: number): T[] => {
  const copy = [...rows];
  let s = seed;
  const next = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s;
  };
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    const a = assertDefined(copy[i], "shuffle: index out of bounds");
    const b = assertDefined(copy[j], "shuffle: index out of bounds");
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
};

describe("I3 Order-invariance", () => {
  it("any permutation of the candles array yields a deep-equal artifact", () => {
    fc.assert(
      fc.property(
        candleSeriesArbitrary,
        fc.integer({ min: 0, max: 1_000_000 }),
        (candles, seed) => {
          const lastCandle = assertDefined(candles.at(-1), "test setup: missing last candle");
          const baseView: IndicatorsInput["view"] = {
            calendar: [],
            candles,
            corporateActions: [],
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [],
            dividendYields: [],
            impliedVolatilityIndex: [],
          };
          const input: IndicatorsInput = {
            view: baseView,
            ticker: "PETR4",
            timeframe: "D1",
            indicators: [{ kind: "sma", length: 3 }],
            at: lastCandle.asOf,
          };
          const shuffled: IndicatorsInput = {
            ...input,
            view: { ...baseView, candles: shuffle(candles, seed) },
          };
          expect(computeIndicators(shuffled)).toEqual(computeIndicators(input));
        },
      ),
    );
  });

  it("rejects duplicate candle keys regardless of where the duplicate sits in the array", () => {
    fc.assert(
      fc.property(
        candleSeriesArbitrary,
        fc.integer({ min: 0, max: 1_000_000 }),
        (candles, seed) => {
          fc.pre(candles.length > 1);
          const firstCandle = assertDefined(candles[0], "test setup: missing first candle");
          const duplicated = shuffle([...candles, firstCandle], seed);
          const result = computeIndicators({
            view: {
              calendar: [],
              candles: duplicated,
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
            indicators: [{ kind: "sma", length: 3 }],
            at: assertDefined(candles.at(-1), "test setup: missing last candle").asOf,
          });
          expect(result.ok).toBe(false);
        },
      ),
    );
  });
});
