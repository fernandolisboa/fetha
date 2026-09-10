import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  EvaluateStrategyInput,
  IndicatorsInput,
  MarketView,
  RunBacktestInput,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { computeIndicators } from "../internal/indicators-computation";
import { assertDefined } from "../internal/invariant";
import { runBacktest } from "../internal/run-backtest";
import { decimalString } from "../test/support";
import { candleSeriesArbitrary, longBacktestFixtureArbitrary } from "./arbitraries";

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

  it("identical evaluateStrategy inputs, round-tripped through JSON, yield byte-identical artifacts", () => {
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        const lastCandle = assertDefined(candles.at(-1), "test setup: missing last candle");
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
          strategy,
          instruments: ["PETR4"],
          at: lastCandle.asOf,
        };
        const first = evaluateStrategy(input);
        const second = evaluateStrategy(JSON.parse(JSON.stringify(input)) as EvaluateStrategyInput);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
    );
  });

  it("identical runBacktest inputs, round-tripped through JSON, yield byte-identical artifacts", () => {
    fc.assert(
      fc.property(longBacktestFixtureArbitrary, (fixture) => {
        const view: MarketView = {
          calendar: fixture.calendar,
          candles: fixture.candles,
          corporateActions: [],
          optionSeries: [],
          optionPrices: [],
          quotes: [],
          macro: [
            {
              series: "cdi",
              date: fixture.calendar[0]?.date ?? "",
              asOf: fixture.calendar[0]?.open ?? "",
              annualRate: fixture.cdiAnnualRate,
            },
          ],
          dividendYields: [],
          impliedVolatilityIndex: [],
        };
        const input: RunBacktestInput = { view, config: fixture.config };
        const first = runBacktest(input);
        const second = runBacktest(JSON.parse(JSON.stringify(input)) as RunBacktestInput);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});
