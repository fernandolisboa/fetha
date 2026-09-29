import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, IndicatorSpec } from "@fetha/contracts";
import type { Candle, MarketView, Signal, StrategyVersion } from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { assertDefined } from "../internal/invariant";
import { centavos, decimalString } from "../test/support";
import { ohlcArbitrary } from "./arbitraries";

// #239: a recursive indicator's reading at an instant depends only on the fixed trailing window
// dataWindow requests for it (3 * length candles ending there), never on how much older history
// the view happens to hold, so a one-night run and a catch-up evaluating the same session agree.

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

const specs: [IndicatorSpec, ...IndicatorSpec[]] = [
  { kind: "ema", length: 2 },
  { kind: "rsi", length: 3 },
  { kind: "atr", length: 2 },
];
const LONGEST_WINDOW = 9;

const alwaysHolds = (indicator: IndicatorSpec): Condition => ({
  kind: "or",
  conditions: [
    {
      kind: "compare",
      left: { kind: "indicator", indicator },
      comparator: ">=",
      right: { kind: "constant", value: decimalString("0") },
    },
    {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    },
  ],
});

const strategy: StrategyVersion = {
  id: "v1",
  definition: {
    name: "test",
    timeframe: "D1",
    entry: {
      kind: "and",
      conditions: [alwaysHolds(specs[0]), ...specs.slice(1).map(alwaysHolds)],
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

const sessionAt = (index: number): string =>
  new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);

const seriesArbitrary = fc
  .array(ohlcArbitrary, { minLength: LONGEST_WINDOW, maxLength: 40 })
  .map((ohlcs) =>
    ohlcs.map((ohlc, i): Candle => {
      const session = sessionAt(i);
      return {
        ticker: "PETR4",
        timeframe: "D1",
        session,
        asOf: `${session}T21:00:00.000Z`,
        ...ohlc,
        tradedQuantity: 1000,
      };
    }),
  );

function evaluateAtLastClose(candles: readonly Candle[]): unknown {
  const at = assertDefined(candles.at(-1), "test setup: missing last candle").asOf;
  const result = evaluateStrategy({
    view: { ...emptyView, candles: [...candles] },
    strategy,
    instruments: ["PETR4"],
    at,
    riskProfile: {
      declaredCapital: centavos(1_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 100,
        maxPremiumBought: decimalString("1"),
      },
    },
  });
  if (!result.ok) throw new Error("test setup: unexpected engine error");
  return { signals: result.value.signals, evaluations: result.value.evaluations };
}

describe("Recursive indicator warm-up invariance (#239)", () => {
  it("reads EMA, RSI and ATR at an instant the same whatever history precedes their trailing window", () => {
    let sawSignal = false;
    fc.assert(
      fc.property(seriesArbitrary, fc.nat(), (candles, drop) => {
        const trimmed = candles.slice(drop % (candles.length - LONGEST_WINDOW + 1));
        const full = evaluateAtLastClose(candles);
        expect(evaluateAtLastClose(trimmed)).toEqual(full);
        if ((full as { signals: Signal[] }).signals.length > 0) sawSignal = true;
      }),
    );
    expect(sawSignal).toBe(true);
  });
});
