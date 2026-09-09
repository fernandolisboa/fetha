import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  EvaluateStrategyInput,
  ImpliedVolatilityIndexPoint,
  IndicatorsInput,
  MarketView,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { decimalString } from "../test/support";
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

  it("any permutation of candles, corporateActions and impliedVolatilityIndex together yields a deep-equal artifact, with two tickers sharing one asOf", () => {
    fc.assert(
      fc.property(
        candleSeriesArbitrary,
        fc.integer({ min: 0, max: 1_000_000 }),
        (candles, seed) => {
          fc.pre(candles.length >= 3);
          const lastCandle = assertDefined(candles.at(-1), "test setup: missing last candle");
          const sharedAsOf = lastCandle.asOf;
          const otherTickerCandle: Candle = {
            ...lastCandle,
            ticker: "VALE3",
            asOf: sharedAsOf,
          };
          const allCandles: Candle[] = [...candles, otherTickerCandle];
          const factors: CorporateActionFactor[] = [
            {
              ticker: "PETR4",
              exDate: assertDefined(candles[1], "test setup: missing second candle").session,
              asOf: assertDefined(candles[0], "test setup: missing first candle").asOf,
              factor: decimalString("0.5"),
            },
            {
              ticker: "VALE3",
              exDate: assertDefined(candles[1], "test setup: missing second candle").session,
              asOf: sharedAsOf,
              factor: decimalString("2"),
            },
          ];
          const ivPoints: ImpliedVolatilityIndexPoint[] = candles.map((c) => ({
            underlying: "PETR4",
            session: c.session,
            asOf: c.asOf,
            impliedVolatility: decimalString("0.30"),
          }));
          const baseView: IndicatorsInput["view"] = {
            calendar: [],
            candles: allCandles,
            corporateActions: factors,
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [],
            dividendYields: [],
            impliedVolatilityIndex: ivPoints,
          };
          const input: IndicatorsInput = {
            view: baseView,
            ticker: "PETR4",
            timeframe: "D1",
            indicators: [
              { kind: "sma", length: 3 },
              { kind: "iv_rank", lookbackSessions: 2 },
            ],
            at: lastCandle.asOf,
          };
          const shuffled: IndicatorsInput = {
            ...input,
            view: {
              ...baseView,
              candles: shuffle(allCandles, seed),
              corporateActions: shuffle(factors, seed + 1),
              impliedVolatilityIndex: shuffle(ivPoints, seed + 2),
            },
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

  it("any permutation of candles, macro and dividendYields across a two-instrument evaluateStrategy batch yields a deep-equal artifact", () => {
    fc.assert(
      fc.property(
        candleSeriesArbitrary,
        fc.integer({ min: 0, max: 1_000_000 }),
        (candles, seed) => {
          fc.pre(candles.length >= 4);
          const otherTickerCandles: Candle[] = candles.map((c) => ({ ...c, ticker: "VALE3" }));
          const allCandles = [...candles, ...otherTickerCandles];
          const macro = candles.map((c, i) => ({
            series: "cdi" as const,
            date: c.session,
            asOf: c.asOf,
            annualRate: decimalString(i % 2 === 0 ? "0.10" : "0.11"),
          }));
          const firstCandleAsOf = assertDefined(
            candles[0],
            "test setup: missing first candle",
          ).asOf;
          const dividendYields = [
            { underlying: "PETR4", asOf: firstCandleAsOf, annualYield: decimalString("0.05") },
            { underlying: "VALE3", asOf: firstCandleAsOf, annualYield: decimalString("0.06") },
          ];
          const view: MarketView = {
            calendar: [],
            candles: allCandles,
            corporateActions: [],
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro,
            dividendYields,
            impliedVolatilityIndex: [],
          };
          const strategy: StrategyVersion = {
            id: "v1",
            definition: {
              name: "test",
              timeframe: "D1",
              entry: {
                kind: "compare",
                left: { kind: "price", field: "close" },
                comparator: ">",
                right: { kind: "indicator", indicator: { kind: "sma", length: 3 } },
              },
              structureId: "stock",
              strikes: [],
              sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
              exit: [],
              adjustments: [],
            },
            structure: {
              id: "stock",
              name: "Stock",
              expiry: "shared",
              legs: [{ role: "stock", side: "buy", ratio: 1 }],
            },
          };
          const input: EvaluateStrategyInput = {
            view,
            strategy,
            instruments: ["PETR4", "VALE3"],
            at: assertDefined(candles.at(-1), "test setup: missing last candle").asOf,
          };
          const shuffled: EvaluateStrategyInput = {
            ...input,
            view: {
              ...view,
              candles: shuffle(allCandles, seed),
              macro: shuffle(macro, seed + 1),
              dividendYields: shuffle(dividendYields, seed + 2),
            },
          };
          expect(evaluateStrategy(shuffled)).toEqual(evaluateStrategy(input));
        },
      ),
    );
  });
});
