import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  EvaluateStrategyInput,
  MarketView,
  Operation,
  StrategyVersion,
} from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { decimalString, quantity } from "../test/support";

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
      right: { kind: "price", field: "close" },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.1") }],
    adjustments: [],
  },
  structure: {
    id: "stock",
    name: "Stock",
    expiry: "shared",
    legs: [{ role: "stock", side: "buy", ratio: 1 }],
  },
};

// `entryPrice` and `trueMove` fix the operation's true, split-scale-independent money move
// (quantity * trueMove); `close` is then derived for the given split factor exactly as
// `buildCandleSeries` would emit it, so the fired/not-fired verdict must not depend on which
// factor happened to be recorded, only on the real, unadjusted-scale move.
function closeForFactor(entryPrice: Decimal, trueMove: Decimal, factor: Decimal): string {
  return entryPrice.add(trueMove).mul(factor).toString();
}

function fired(entryPrice: Decimal, trueMove: Decimal, factor: Decimal): boolean {
  const operation: Operation = {
    id: "op-1",
    underlying: "PETR4",
    legs: [
      {
        role: "stock",
        side: "buy",
        ticker: "PETR4",
        quantity: quantity(10),
        entryPrice: decimalString(entryPrice.toString()),
      },
    ],
    expiry: null,
    openedAt: "2024-01-01",
    strategyVersionId: "v1",
    rolledFrom: null,
  };
  const close = closeForFactor(entryPrice, trueMove, factor);
  const candle: Candle = {
    ticker: "PETR4",
    timeframe: "D1",
    session: "2024-01-04",
    asOf: "2024-01-04T21:00:00.000Z",
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
  const corporateAction: CorporateActionFactor = {
    ticker: "PETR4",
    exDate: "2024-01-03",
    asOf: "2024-01-03T13:00:00.000Z",
    factor: decimalString(factor.toString()),
  };
  const input: EvaluateStrategyInput = {
    view: { ...emptyView, candles: [candle], corporateActions: [corporateAction] },
    strategy,
    instruments: ["PETR4"],
    at: "2024-01-04T21:00:00.000Z",
    openOperations: [operation],
  };
  const result = evaluateStrategy(input);
  if (!result.ok) throw new Error("test setup: unexpected engine error");
  return result.value.evaluations[0]?.outcome === "signal";
}

const entryPriceCentsArbitrary = fc.integer({ min: 100, max: 100_000 });
const trueMoveMillisArbitrary = fc.integer({ min: -500, max: 500 });
const factorHundredthsArbitrary = fc.integer({ min: 1, max: 1000 });

describe("Exit rule scale invariance", () => {
  it("keeps the stop_loss fired/not-fired verdict unchanged across an arbitrary positive split factor, holding the true (unadjusted-scale) money move fixed", () => {
    fc.assert(
      fc.property(
        entryPriceCentsArbitrary,
        trueMoveMillisArbitrary,
        factorHundredthsArbitrary,
        factorHundredthsArbitrary,
        (entryCents, moveMillis, f1Hundredths, f2Hundredths) => {
          const entryPrice = new Decimal(entryCents).div(100);
          const trueMove = entryPrice.mul(new Decimal(moveMillis).div(1000));
          const f1 = new Decimal(f1Hundredths).div(100);
          const f2 = new Decimal(f2Hundredths).div(100);

          const verdict1 = fired(entryPrice, trueMove, f1);
          const verdict2 = fired(entryPrice, trueMove, f2);

          expect(verdict2).toBe(verdict1);
        },
      ),
    );
  });
});
