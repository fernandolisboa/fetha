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

const fixedRiskStrategy: StrategyVersion = {
  ...strategy,
  definition: {
    ...strategy.definition,
    sizing: { kind: "fixed_risk", fraction: decimalString("0.1") },
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

  it("evaluates a stock-only strategy, including fixed_risk sizing, end to end with no candles to evaluate", async () => {
    const result = await engine.evaluateStrategy({
      view: emptyView,
      strategy: fixedRiskStrategy,
      instruments: ["PETR4"],
      at: "2024-01-01T00:00:00.000Z",
    } satisfies EvaluateStrategyInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations).toEqual([
      {
        ticker: "PETR4",
        at: "2024-01-01T00:00:00.000Z",
        session: "2024-01-01",
        outcome: "insufficient_data",
        detail: "no candles for this instrument and timeframe",
      },
    ]);
    expect(result.value.signals).toEqual([]);
  });

  it("reports unsupported with the strike-selection kind for evaluateStrategy on a structure with option legs", async () => {
    const optionStrategy: StrategyVersion = {
      id: "v1",
      definition: {
        ...strategy.definition,
        structureId: "covered_call",
        strikes: [{ kind: "moneyness", percent: decimalString("0.05") }],
        expiry: { kind: "business_days", min: 20, max: 45 },
      },
      structure: {
        id: "covered_call",
        name: "Covered call",
        expiry: "shared",
        legs: [
          { role: "stock", side: "buy", ratio: 1 },
          { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
        ],
      },
    };
    const result = await engine.evaluateStrategy({
      view: emptyView,
      strategy: optionStrategy,
      instruments: ["PETR4"],
      at: "2024-01-01T00:00:00.000Z",
    } satisfies EvaluateStrategyInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "unsupported",
      vocabulary: "strikeSelections",
      kind: "moneyness",
    });
  });

  it("reports the caller's strategy sizing kind for runBacktest, not a fixed vocabulary entry", async () => {
    const result = await engine.runBacktest({
      view: emptyView,
      config: {
        strategy: fixedRiskStrategy,
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
    } satisfies RunBacktestInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "unsupported",
      vocabulary: "sizingRules",
      kind: "fixed_risk",
    });
  });
});
