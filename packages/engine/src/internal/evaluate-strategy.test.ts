import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  Candle,
  CorporateActionFactor,
  DividendYieldPoint,
  EvaluateStrategyInput,
  MacroPoint,
  MarketView,
  Operation,
  Signal,
  StrategyVersion,
} from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import { evaluateStrategy } from "./evaluate-strategy";

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

const sessionAt = (index: number): string => {
  const d = new Date(Date.UTC(2024, 0, 1 + index));
  return d.toISOString().slice(0, 10);
};

const dailyCandle = (ticker: string, index: number, close: string): Candle => {
  const session = sessionAt(index);
  return {
    ticker,
    timeframe: "D1",
    session,
    asOf: `${session}T21:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
};

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
};

const definition = (
  overrides: Partial<StrategyDefinition> & Pick<StrategyDefinition, "entry">,
): StrategyDefinition => ({
  name: "test",
  timeframe: "D1",
  structureId: "stock",
  strikes: [],
  sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
  exit: [],
  adjustments: [],
  ...overrides,
});

const strategyVersion = (
  def: StrategyDefinition,
  structure: Structure = stockStructure,
): StrategyVersion => ({
  id: "v1",
  definition: def,
  structure,
});

const riskProfile = {
  declaredCapital: centavos(100_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 5,
    maxPremiumBought: decimalString("1"),
  },
};

const closeAboveSma = (length: number): Condition => ({
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "indicator", indicator: { kind: "sma", length } },
});

describe("evaluateStrategy — stock-only strategies", () => {
  it("fires an entry signal when close > sma(3) holds at the latest close", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      riskProfile: {
        declaredCapital: centavos(100_000_00),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations).toEqual([
      {
        ticker: "PETR4",
        at: "2024-01-04T21:00:00.000Z",
        session: "2024-01-04",
        outcome: "signal",
        detail: null,
      },
    ]);
    expect(result.value.signals).toHaveLength(1);
    const signal = result.value.signals[0] as Extract<Signal, { kind: "entry" }>;
    expect(signal.kind).toBe("entry");
    expect(signal.indicators).toEqual([
      { indicator: { kind: "sma", length: 3 }, value: decimalString("11.00") },
    ]);
    // budget = 0.5 * 100_000_00 = 5_000_000 centavos; price 13.00 -> 1300 centavos; units = floor(5_000_000/1300) = 3846
    expect(signal.proposal.legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(3846) },
    ]);
    expect(signal.proposal.pricing.maxLoss).toBe(centavos(13_00 * 3846));
    expect(signal.proposal.pricing.maxGain).toBe("unbounded");
  });

  it("matches the published Wilder RSI(14) reference series for an rsi < 71 entry", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28,
    ].map((n) => n.toFixed(2));
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const entry: Condition = {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "rsi", length: 14 } },
      comparator: "<",
      right: { kind: "constant", value: decimalString("71") },
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry })),
      instruments: ["PETR4"],
      at: `${sessionAt(14)}T21:00:00.000Z`,
      riskProfile,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    const signal = result.value.signals[0] as Extract<Signal, { kind: "entry" }>;
    expect(signal.indicators).toEqual([
      { indicator: { kind: "rsi", length: 14 }, value: decimalString("70.464135") },
    ]);
  });

  it("evaluates an and/or/not condition tree", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const entry: Condition = {
      kind: "and",
      conditions: [
        closeAboveSma(3),
        {
          kind: "not",
          condition: {
            kind: "or",
            conditions: [
              {
                kind: "compare",
                left: { kind: "price", field: "close" },
                comparator: "<",
                right: { kind: "constant", value: decimalString("0") },
              },
              {
                kind: "compare",
                left: { kind: "price", field: "tradedQuantity" },
                comparator: "<",
                right: { kind: "constant", value: decimalString("500") },
              },
            ],
          },
        },
      ],
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      riskProfile,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
  });

  it("records conditions_not_met when the entry condition does not hold", () => {
    const closes = ["10.00", "10.00", "10.00", "9.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations).toEqual([
      {
        ticker: "PETR4",
        at: "2024-01-04T21:00:00.000Z",
        session: "2024-01-04",
        outcome: "conditions_not_met",
        detail: null,
      },
    ]);
    expect(result.value.signals).toEqual([]);
  });

  it("records insufficient_data when the indicator has not warmed up", () => {
    const closes = ["10.00", "11.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(20) })),
      instruments: ["PETR4"],
      at: "2024-01-02T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("insufficient_data");
    expect(result.value.signals).toEqual([]);
  });

  const stockOperation = (id: string): Operation => ({
    id,
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
    strategyVersionId: "v1",
    rolledFrom: null,
  });

  it("fires an exit signal when the profit target is reached", () => {
    const closes = ["10.00", "10.00", "10.00", "16.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    expect(result.value.signals).toEqual([
      {
        kind: "exit",
        strategyVersionId: "v1",
        ticker: "PETR4",
        timeframe: "D1",
        at: "2024-01-04T21:00:00.000Z",
        session: "2024-01-04",
        indicators: [],
        operationId: "op-1",
        rule: { kind: "profit_target", fractionOfPremium: decimalString("0.5") },
      },
    ]);
  });

  it("fires an exit signal when the stop loss is reached", () => {
    const closes = ["10.00", "10.00", "10.00", "5.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.3") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    expect(result.value.signals[0]).toMatchObject({ kind: "exit", operationId: "op-1" });
  });

  it("does not fire an exit signal when neither exit rule threshold is reached", () => {
    const closes = ["10.00", "10.00", "10.00", "10.50"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [
            { kind: "profit_target", fractionOfPremium: decimalString("0.5") },
            { kind: "stop_loss", multipleOfMaxLoss: decimalString("0.5") },
          ],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("conditions_not_met");
    expect(result.value.signals).toEqual([]);
  });

  it("scales the close (not the quantity) by a 2:1 split factor, so a true +R$200 gain fires a 5% profit_target", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 3, "16.00")],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-03",
          asOf: "2024-01-03T13:00:00.000Z",
          factor: decimalString("0.5"),
        } satisfies CorporateActionFactor,
      ],
    };
    const preSplitOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("30.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.05") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [preSplitOperation],
    };
    // Each pre-split share became 2 post-split shares: 100 old shares are worth what 200 shares
    // at the post-split close represent, i.e. close / factor = 16.00 / 0.5 = 32.00 per old share.
    // True pnl = 100 * (32.00 - 30.00) = +R$200, well past a 5% target on a R$3000 premium base.
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    expect(result.value.signals[0]).toMatchObject({ kind: "exit", operationId: "op-1" });
  });

  it("scales the close (not the quantity) by a 10:1 reverse split factor, so a true −R$100 loss does not fire a 10% stop_loss", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 3, "29.00")],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-03",
          asOf: "2024-01-03T13:00:00.000Z",
          factor: decimalString("10"),
        } satisfies CorporateActionFactor,
      ],
    };
    const preSplitOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(1000),
          entryPrice: decimalString("3.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.1") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [preSplitOperation],
    };
    // Every 10 pre-split shares became 1 post-split share: close / factor = 29.00 / 10 = 2.90 per
    // old share. True pnl = 1000 * (2.90 - 3.00) = -R$100, short of a 10% stop on a R$3000 base.
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("conditions_not_met");
    expect(result.value.signals).toEqual([]);
  });

  it("does not enter when an open operation already exists for the instrument", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No exit rules on the definition, so exit is never evaluated: conditions_not_met.
    expect(result.value.evaluations[0]?.outcome).toBe("conditions_not_met");
    expect(result.value.signals).toEqual([]);
  });

  it("returns unsupported for a structure with option legs, citing the strike selection kind", () => {
    const optionStructure: Structure = {
      id: "covered_call",
      name: "Covered call",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      ] as LegTemplate[],
    };
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          structureId: "covered_call",
          strikes: [{ kind: "moneyness", percent: decimalString("0.05") }],
          expiry: { kind: "business_days", min: 20, max: 45 },
        }),
        optionStructure,
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "unsupported",
      vocabulary: "strikeSelections",
      kind: "moneyness",
    });
  });

  it("rejects a stock-only definition with strikes as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          strikes: [{ kind: "moneyness", percent: decimalString("0") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.strikes",
      message: "a stock-only structure cannot select strikes",
    });
  });

  it("rejects mismatched structureId as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3), structureId: "other" })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.structureId",
      message: "definition.structureId must match structure.id",
    });
  });

  it("rejects since >= at as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      since: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "since",
      message: "since must be strictly before at",
    });
  });

  it("rejects an open operation whose underlying is not among the instruments", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["VALE3"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "openOperations[0].underlying",
      message: "an open operation's underlying must be among the batch's instruments",
    });
  });

  it("evaluates at every close in (since, at] on catch-up", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00", "14.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      since: "2024-01-03T21:00:00.000Z",
      at: "2024-01-05T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations.map((e) => e.at)).toEqual([
      "2024-01-04T21:00:00.000Z",
      "2024-01-05T21:00:00.000Z",
    ]);
  });

  it("records one insufficient_data evaluation per instrument when there are no candles for it", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations).toEqual([
      {
        ticker: "PETR4",
        at: "2024-01-04T21:00:00.000Z",
        session: "2024-01-04",
        outcome: "insufficient_data",
        detail: "no candles for this instrument and timeframe",
      },
    ]);
    expect(result.value.signals).toEqual([]);
  });

  it("resolves the record's session from the calendar rather than slicing at's own date", () => {
    const view: MarketView = {
      ...emptyView,
      calendar: [
        { date: "2024-01-04", open: "2024-01-05T00:30:00.000Z", close: "2024-01-05T03:00:00.000Z" },
      ],
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-05T01:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.session).toBe("2024-01-04");
  });

  it("falls back to slicing at's own date when the view carries no calendar row", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-05T01:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.session).toBe("2024-01-05");
  });

  it("records insufficient_data when no candle falls in (since, at], distinct from no candles at all", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 0, "10.00")],
    };
    const since = "2024-01-01T21:00:00.000Z";
    const at = "2024-01-01T21:00:00.001Z";
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      since,
      at,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations).toEqual([
      {
        ticker: "PETR4",
        at,
        session: "2024-01-01",
        outcome: "insufficient_data",
        detail: "no candles in (since, at] for this instrument and timeframe",
      },
    ]);
    expect(result.value.signals).toEqual([]);
  });

  it("validates the whole view for duplicates even when instruments is empty", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 0, "10.00"), dailyCandle("PETR4", 0, "11.00")],
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: [],
      at: "2024-01-01T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("rejects a stock-only definition with an expiry selection as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({ entry: closeAboveSma(3), expiry: { kind: "business_days", min: 5, max: 10 } }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.expiry",
      message: "a stock-only structure has no expiry to select",
    });
  });

  it("rejects a stock-only definition with a days_before_expiry exit rule as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "days_before_expiry", businessDays: 3 }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.exit",
      message: "days_before_expiry is meaningless for a stock-only structure",
    });
  });

  it("rejects a stock-only definition with a roll adjustment as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          adjustments: [
            {
              kind: "roll",
              when: { kind: "days_before_expiry", businessDays: 3 },
              expiry: { kind: "business_days", min: 5, max: 10 },
              strikes: [{ kind: "moneyness", percent: decimalString("0") }],
            },
          ],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.adjustments",
      message: "roll is meaningless for a stock-only structure",
    });
  });

  const optionStructure: Structure = {
    id: "covered_call",
    name: "Covered call",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  it("rejects a structure with option legs and no expiry selection as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          structureId: "covered_call",
          strikes: [{ kind: "moneyness", percent: decimalString("0") }],
        }),
        optionStructure,
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.expiry",
      message: "a structure with option legs requires an expiry selection",
    });
  });

  it("rejects a structure with option legs whose strikes.length does not match distinct ranks", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          structureId: "covered_call",
          strikes: [],
          expiry: { kind: "business_days", min: 5, max: 10 },
        }),
        optionStructure,
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "strategy.definition.strikes",
      message: "strikes.length must equal the number of distinct strike ranks",
    });
  });

  it("rejects an open operation with an option leg as invalid_input", () => {
    const optionOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C40",
          quantity: quantity(100),
          entryPrice: decimalString("1.00"),
        },
      ],
      expiry: "2024-02-01",
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [optionOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "openOperations[0].legs",
      message: "evaluateStrategy only evaluates stock-only operations for now",
    });
  });

  it("rejects a stock-only open operation that carries an expiry as invalid_input", () => {
    const badOperation: Operation = {
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
      expiry: "2024-02-01",
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [badOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "openOperations[0].expiry",
      message: "a stock-only operation must not have an expiry",
    });
  });

  it("propagates a duplicate-candle error from the per-ticker candle series as invalid_input", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [dailyCandle("PETR4", 0, "10.00"), dailyCandle("PETR4", 0, "11.00")],
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-01T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("fires an exit signal for a short stock operation on a profit target", () => {
    const closes = ["10.00", "10.00", "10.00", "4.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const shortOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [shortOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
  });

  it("fires an exit signal when a condition-based exit rule holds", () => {
    const closes = ["10.00", "10.00", "10.00", "9.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const exitCondition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "indicator", indicator: { kind: "sma", length: 3 } },
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "condition", condition: exitCondition }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    const signal = result.value.signals[0] as Extract<Signal, { kind: "exit" }>;
    expect(signal.indicators).toEqual([
      { indicator: { kind: "sma", length: 3 }, value: decimalString("9.67") },
    ]);
  });

  it("records insufficient_data on exit when the condition-based rule cannot be evaluated yet", () => {
    const closes = ["10.00", "11.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const exitCondition: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: "<",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "condition", condition: exitCondition }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-02T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("insufficient_data");
  });

  it("rejects a duplicate ticker in instruments as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4", "PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "instruments",
      message: "duplicate instrument PETR4",
    });
  });

  it("rejects a duplicate operation id as invalid_input", () => {
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1"), stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "openOperations",
      message: "duplicate operation id op-1",
    });
  });

  it("rejects an open operation whose stock leg ticker does not match its underlying", () => {
    const mismatched: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [mismatched],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "openOperations[0].legs[0].ticker",
      message: "a stock leg's ticker must match the operation's underlying",
    });
  });

  it("rejects duplicate corporate-action factors across the whole view as invalid_input", () => {
    const factor = {
      ticker: "PETR4",
      exDate: "2024-01-02",
      asOf: "2024-01-02T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const input: EvaluateStrategyInput = {
      view: { ...emptyView, corporateActions: [factor, factor] },
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
    expect(result.error).toMatchObject({ path: "view.corporateActions" });
  });

  it("rejects a duplicate (series, asOf) pair in macro as invalid_input", () => {
    const point = {
      series: "cdi" as const,
      date: "2024-01-02",
      asOf: "2024-01-02T21:00:00.000Z",
      annualRate: decimalString("0.10"),
    };
    const input: EvaluateStrategyInput = {
      view: { ...emptyView, macro: [point, point] },
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "invalid_input", path: "view.macro" });
  });

  it("rejects a duplicate (underlying, asOf) pair in dividendYields as invalid_input", () => {
    const point = {
      underlying: "PETR4",
      asOf: "2024-01-02T21:00:00.000Z",
      annualYield: decimalString("0.05"),
    };
    const input: EvaluateStrategyInput = {
      view: { ...emptyView, dividendYields: [point, point] },
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "invalid_input", path: "view.dividendYields" });
  });

  it("rejects a macro annualRate of -100% or below as invalid_input, at the macro row's own path", () => {
    const point: MacroPoint = {
      series: "cdi",
      date: "2024-01-02",
      asOf: "2024-01-02T21:00:00.000Z",
      annualRate: decimalString("-1"),
    };
    const input: EvaluateStrategyInput = {
      view: { ...emptyView, macro: [point] },
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "view.macro[0].annualRate",
      message: "an annual rate of -100% or below makes ln(1 + rate) undefined",
    });
  });

  it("rejects a dividend annualYield of -100% or below as invalid_input, at the row's own path", () => {
    const point: DividendYieldPoint = {
      underlying: "PETR4",
      asOf: "2024-01-02T21:00:00.000Z",
      annualYield: decimalString("-1.50"),
    };
    const input: EvaluateStrategyInput = {
      view: { ...emptyView, dividendYields: [point] },
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "view.dividendYields[0].annualYield",
      message: "an annual yield of -100% or below makes ln(1 + yield) undefined",
    });
  });

  it("rejects a candle with a non-positive close, at its true index in view.candles", () => {
    const badView: MarketView = {
      ...emptyView,
      candles: [{ ...dailyCandle("PETR4", 0, "10.00"), close: decimalString("0.00") }],
    };
    const input: EvaluateStrategyInput = {
      view: badView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-01T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "invalid_input", path: "view.candles[0].close" });
  });

  it("rejects a non-positive candle for a ticker outside instruments, not just referenced ones", () => {
    const badView: MarketView = {
      ...emptyView,
      candles: [
        dailyCandle("PETR4", 0, "10.00"),
        { ...dailyCandle("VALE3", 0, "10.00"), close: decimalString("0.00") },
      ],
    };
    const input: EvaluateStrategyInput = {
      view: badView,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4"],
      at: "2024-01-01T21:00:00.000Z",
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "invalid_input", path: "view.candles[1].close" });
  });

  it("gates entry only from the session an open operation was actually opened at (openedAt catch-up)", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00", "14.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const lateOperation: Operation = {
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
      openedAt: "2024-01-05",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.01") }],
        }),
      ),
      instruments: ["PETR4"],
      since: "2024-01-03T21:00:00.000Z",
      at: "2024-01-05T21:00:00.000Z",
      openOperations: [lateOperation],
      riskProfile,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Before openedAt (2024-01-04), the operation is invisible: entry is evaluated normally
    // and fires. From openedAt on (2024-01-05), entry is gated and only the exit rule runs.
    expect(result.value.evaluations.map((e) => e.outcome)).toEqual(["signal", "signal"]);
    expect(result.value.signals.map((s) => ({ kind: s.kind, at: s.at }))).toEqual([
      { kind: "entry", at: "2024-01-04T21:00:00.000Z" },
      { kind: "exit", at: "2024-01-05T21:00:00.000Z" },
    ]);
    const exitSignal = result.value.signals[1] as Extract<Signal, { kind: "exit" }>;
    expect(exitSignal.session >= lateOperation.openedAt).toBe(true);
  });

  it("does not count a portfolio operation opened after the instant toward maxOpenOperations", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const futureOperation: Operation = {
      id: "future-op",
      underlying: "VALE3",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(1),
          entryPrice: decimalString("1.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-05",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(definition({ entry: closeAboveSma(3) })),
      instruments: ["PETR4", "VALE3"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [futureOperation],
      riskProfile: { ...riskProfile, limits: { ...riskProfile.limits, maxOpenOperations: 1 } },
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entrySignal = result.value.signals.find((s) => s.ticker === "PETR4");
    expect(entrySignal?.kind).toBe("entry");
    if (entrySignal?.kind !== "entry") return;
    expect(entrySignal.proposal.pricing.limitBreaches).toEqual([]);
    expect(entrySignal.proposal.pricing.notes.some((n) => n.code === "limit_breach_warned")).toBe(
      false,
    );
  });

  it("tries exit rules in definition order and stops at the first that fires", () => {
    const closes = ["10.00", "10.00", "10.00", "10.50"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const alsoAlwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("-1") },
    };
    const firstRule: Extract<ReturnType<typeof definition>["exit"][number], { kind: "condition" }> =
      { kind: "condition", condition: alwaysTrue };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [firstRule, { kind: "condition", condition: alsoAlwaysTrue }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [stockOperation("op-1")],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signals).toHaveLength(1);
    const signal = result.value.signals[0] as Extract<Signal, { kind: "exit" }>;
    expect(signal.rule).toEqual(firstRule);
  });

  it("does not fire a numeric exit rule whose base is zero, and records why", () => {
    const closes = ["10.00", "10.00", "10.00", "10.50"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const deltaNeutralOperation: Operation = {
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
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [deltaNeutralOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.signals).toEqual([]);
    expect(result.value.evaluations[0]).toEqual({
      ticker: "PETR4",
      at: "2024-01-04T21:00:00.000Z",
      session: "2024-01-04",
      outcome: "conditions_not_met",
      detail: "profit_target cannot fire: the operation's premium base is zero",
    });
  });

  it("fires stop_loss on a short stock operation using |netPremium| as the max-loss base (unbounded max loss)", () => {
    const closes = ["10.00", "10.00", "10.00", "14.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const shortOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.3") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [shortOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
  });

  it("does not fire stop_loss on a short stock operation when the loss stays under the threshold", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const shortOperation: Operation = {
      id: "op-1",
      underlying: "PETR4",
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.5") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [shortOperation],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("conditions_not_met");
    expect(result.value.signals).toEqual([]);
  });

  it("uses net premium, not gross cost, as the profit_target base on a buy-2/sell-1 structure", () => {
    // buy 100 @ 10.00 + sell 50 @ 8.00: net premium (debit) is 600 reais, gross cost 1400 reais.
    // At close 20.00, pnl is 400 reais: above the net-premium target (0.5 * 600 = 300) but
    // below what the gross-cost target would have required (0.5 * 1400 = 700).
    const closes = ["10.00", "10.00", "10.00", "20.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const structure: Operation = {
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
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(50),
          entryPrice: decimalString("8.00"),
        },
      ],
      expiry: null,
      openedAt: "2024-01-01",
      strategyVersionId: "v1",
      rolledFrom: null,
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      openOperations: [structure],
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
  });

  it("sizes and sends an entry signal under fixed_risk sizing with real candles", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          sizing: { kind: "fixed_risk", fraction: decimalString("0.01") },
        }),
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      riskProfile,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]?.outcome).toBe("signal");
    const signal = result.value.signals[0] as Extract<Signal, { kind: "entry" }>;
    // budget = 0.01 * 100_000_00 = 100_000 centavos; price 13.00 -> 1300 centavos/unit;
    // units = floor(100_000 / 1300) = 76
    expect(signal.proposal.legs).toEqual([
      { role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(76) },
    ]);
  });

  it("is unsizeable under fixed_risk when the structure has a short stock leg, through evaluateStrategy end to end", () => {
    const closes = ["10.00", "10.00", "10.00", "13.00"];
    const view: MarketView = {
      ...emptyView,
      candles: closes.map((close, i) => dailyCandle("PETR4", i, close)),
    };
    const shortStructure: Structure = {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "sell", ratio: 1 }] as LegTemplate[],
    };
    const input: EvaluateStrategyInput = {
      view,
      strategy: strategyVersion(
        definition({
          entry: closeAboveSma(3),
          sizing: { kind: "fixed_risk", fraction: decimalString("0.01") },
        }),
        shortStructure,
      ),
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
      riskProfile,
    };
    const result = evaluateStrategy(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evaluations[0]).toEqual({
      ticker: "PETR4",
      at: "2024-01-04T21:00:00.000Z",
      session: "2024-01-04",
      outcome: "unsizeable",
      detail: "fixed_risk sizing is unsizeable against an unbounded max loss",
    });
    expect(result.value.signals).toEqual([]);
  });
});
