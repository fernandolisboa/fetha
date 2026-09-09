import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  EvaluateStrategyInput,
  Evaluation,
  MarketView,
  Result,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { assertDefined } from "../internal/invariant";
import { centavos, decimalString } from "../test/support";
import { candleSeriesArbitrary } from "./arbitraries";

const riskProfile = {
  declaredCapital: centavos(1_000_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 100,
    maxPremiumBought: decimalString("1"),
  },
};

const emptyView: MarketView = {
  calendar: [],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
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

const stripTruncated = (result: Result<Evaluation>): unknown => {
  if (!result.ok) return result;
  const { provenance, ...rest } = result.value;
  return {
    ok: true,
    value: {
      ...rest,
      provenance: {
        engineVersion: provenance.engineVersion,
        pricingModel: provenance.pricingModel,
        dataVersion: provenance.dataVersion,
        datasetNotes: provenance.datasetNotes,
      },
    },
  };
};

describe("Catch-up equivalence", () => {
  it("evaluating (since, at] in one call yields the same signals and evaluations as evaluating each close separately, with a real riskProfile", () => {
    let sawAtLeastOneSignal = false;
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        fc.pre(candles.length >= 4);
        const view: MarketView = { ...emptyView, candles };
        const input: EvaluateStrategyInput = {
          view,
          strategy,
          instruments: ["PETR4"],
          at: assertDefined(candles.at(-1), "test setup: missing last candle").asOf,
          riskProfile,
        };

        const singleResults = candles.map((candle) => {
          const result = evaluateStrategy({ ...input, at: candle.asOf });
          if (!result.ok) throw new Error("test setup: unexpected engine error");
          return result.value;
        });
        const evaluationsFromSingleCalls = singleResults.flatMap((r) => r.evaluations);
        const signalsFromSingleCalls = singleResults.flatMap((r) => r.signals);
        if (signalsFromSingleCalls.length > 0) sawAtLeastOneSignal = true;

        const firstCandle = assertDefined(candles[0], "test setup: missing first candle");
        const catchUpInput: EvaluateStrategyInput = {
          ...input,
          since: `${firstCandle.session}T00:00:00.000Z`,
        };
        const catchUpResult = evaluateStrategy(catchUpInput);

        expect(stripTruncated(catchUpResult)).toEqual({
          ok: true,
          value: {
            signals: signalsFromSingleCalls,
            evaluations: evaluationsFromSingleCalls,
            notes: [],
            provenance: {
              engineVersion: "0.1.0",
              pricingModel: "bsm_continuous_yield",
              dataVersion: null,
              datasetNotes: [],
            },
          },
        });
      }),
    );
    expect(sawAtLeastOneSignal).toBe(true);
  });

  it("still holds without a riskProfile, on the unsizeable path", () => {
    fc.assert(
      fc.property(candleSeriesArbitrary, (candles) => {
        fc.pre(candles.length >= 4);
        const view: MarketView = { ...emptyView, candles };
        const input: EvaluateStrategyInput = {
          view,
          strategy,
          instruments: ["PETR4"],
          at: assertDefined(candles.at(-1), "test setup: missing last candle").asOf,
        };

        const singleResults = candles.map((candle) => {
          const result = evaluateStrategy({ ...input, at: candle.asOf });
          if (!result.ok) throw new Error("test setup: unexpected engine error");
          return result.value;
        });
        const evaluationsFromSingleCalls = singleResults.flatMap((r) => r.evaluations);
        const signalsFromSingleCalls = singleResults.flatMap((r) => r.signals);

        const firstCandle = assertDefined(candles[0], "test setup: missing first candle");
        const catchUpInput: EvaluateStrategyInput = {
          ...input,
          since: `${firstCandle.session}T00:00:00.000Z`,
        };
        const catchUpResult = evaluateStrategy(catchUpInput);

        expect(stripTruncated(catchUpResult)).toEqual({
          ok: true,
          value: {
            signals: signalsFromSingleCalls,
            evaluations: evaluationsFromSingleCalls,
            notes: [],
            provenance: {
              engineVersion: "0.1.0",
              pricingModel: "bsm_continuous_yield",
              dataVersion: null,
              datasetNotes: [],
            },
          },
        });
      }),
    );
  });
});
