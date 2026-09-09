import { describe, expect, it } from "vitest";
import { engine } from "./engine";
import type {
  DataWindowInput,
  Engine,
  EvaluateStrategyInput,
  IndicatorsInput,
  MarkToMarketInput,
  Operation,
  ProposeSettlementInput,
  RunBacktestInput,
  ScoreInput,
  StrategyVersion,
} from "./api";
import { centavos, confidence, decimalString, quantity } from "./test/support";

const emptyView: IndicatorsInput["view"] = {
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
      right: { kind: "constant", value: decimalString("0") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
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

const stockOperation: Operation = {
  id: "op-1",
  underlying: "PETR4",
  legs: [
    {
      role: "stock",
      side: "buy",
      ticker: "PETR4",
      quantity: quantity(100),
      entryPrice: decimalString("10.00"),
    },
  ],
  expiry: null,
  openedAt: "2024-01-01",
  strategyVersionId: null,
  rolledFrom: null,
};

describe("engine", () => {
  it("satisfies the Engine interface", () => {
    const _typeCheck: Engine = engine;
    expect(_typeCheck).toBe(engine);
  });

  it("implements capabilities, dataWindow and indicators", async () => {
    expect(engine.capabilities().indicators).toEqual(["sma", "ema", "rsi", "atr", "iv_rank"]);

    const dwInput: DataWindowInput = {
      strategy,
      instruments: ["PETR4"],
      calendar: [],
      at: "2024-01-30T20:00:00.000Z",
    };
    expect(engine.dataWindow(dwInput).to).toBe(dwInput.at);

    const indicatorsResult = await engine.indicators({
      view: emptyView,
      ticker: "PETR4",
      timeframe: "D1",
      indicators: [{ kind: "sma", length: 2 }],
      at: "2024-01-30T20:00:00.000Z",
    });
    expect(indicatorsResult.ok).toBe(true);
  });

  it.each([
    [
      "priceOperation",
      () => engine.priceOperation({ view: emptyView, at: "2024-01-01T00:00:00.000Z", legs: [] }),
      { code: "unsupported", vocabulary: "pricingModels", kind: "bsm_continuous_yield" },
    ],
    [
      "evaluateStrategy",
      () =>
        engine.evaluateStrategy({
          view: emptyView,
          strategy,
          instruments: ["PETR4"],
          at: "2024-01-01T00:00:00.000Z",
        } satisfies EvaluateStrategyInput),
      { code: "unsupported", vocabulary: "sizingRules", kind: "fixed_fractional" },
    ],
    [
      "runBacktest",
      () =>
        engine.runBacktest({
          view: emptyView,
          config: {
            strategy,
            universe: ["PETR4"],
            period: { from: "2024-01-01", to: "2024-01-31" },
            initialCapital: centavos(100_000_00),
            costModel: {
              b3FeeRate: decimalString("0.0003"),
              brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
              optionSlippageRate: decimalString("0.01"),
              incomeTaxRate: decimalString("0.15"),
              monthlyStockSalesExemption: centavos(20_000_00),
            },
            riskProfile: {
              declaredCapital: centavos(100_000_00),
              limits: {
                maxLossPerOperation: decimalString("0.02"),
                maxExposurePerOperation: decimalString("0.1"),
                maxOpenOperations: 5,
                maxPremiumBought: decimalString("0.05"),
              },
            },
            limits: "enforce",
            sizing: null,
            walkForward: null,
            seed: 1,
          },
        } satisfies RunBacktestInput),
      { code: "unsupported", vocabulary: "sizingRules", kind: "fixed_fractional" },
    ],
    [
      "markToMarket",
      () =>
        engine.markToMarket({
          view: emptyView,
          at: "2024-01-01T00:00:00.000Z",
          positions: [],
          operations: [],
          cash: centavos(0),
        } satisfies MarkToMarketInput),
      { code: "unsupported", vocabulary: "pricingModels", kind: "bsm_continuous_yield" },
    ],
    [
      "proposeSettlement",
      () =>
        engine.proposeSettlement({
          view: emptyView,
          operation: stockOperation,
        } satisfies ProposeSettlementInput),
      { code: "unsupported", vocabulary: "pricingModels", kind: "bsm_continuous_yield" },
    ],
    [
      "score",
      () =>
        engine.score({
          view: emptyView,
          subject: "analysis",
          decidedAt: "2024-01-01T00:00:00.000Z",
          horizon: "2024-02-01",
          confidence: confidence("0.6"),
          claim: null,
          realizedFills: [],
          origin: { kind: "manual" },
          costModel: {
            b3FeeRate: decimalString("0.0003"),
            brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
            optionSlippageRate: decimalString("0.01"),
            incomeTaxRate: decimalString("0.15"),
            monthlyStockSalesExemption: centavos(20_000_00),
          },
        } satisfies ScoreInput),
      { code: "unsupported", vocabulary: "thesisClaims", kind: "close_above" },
    ],
    [
      "impliedVolatilityIndex",
      () =>
        engine.impliedVolatilityIndex({
          view: emptyView,
          underlying: "PETR4",
          at: "2024-01-01T00:00:00.000Z",
        }),
      { code: "unsupported", vocabulary: "pricingModels", kind: "bsm_continuous_yield" },
    ],
  ] as const)(
    "%s returns its documented unsupported error without throwing",
    async (_name, call, expected) => {
      const result = await call();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toEqual(expected);
    },
  );
});
