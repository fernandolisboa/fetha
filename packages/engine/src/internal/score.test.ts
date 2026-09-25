import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Condition,
  CostModel,
  StrategyDefinition,
  Structure,
  ThesisClaim,
} from "@fetha/contracts";
import type {
  Candle,
  Fill,
  MarketView,
  Operation,
  OptionSeries,
  ScoreInput,
  StrategyVersion,
} from "../api";
import { centavos, confidence, dailyCalendar, decimalString, quantity } from "../test/support";
import { score } from "./score";

const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const calendar = dailyCalendar(1, 10);

const emptyView: MarketView = {
  calendar,
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

const zeroCostModel: CostModel = {
  b3FeeRate: decimalString("0"),
  brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
  optionSlippageRate: decimalString("0"),
  incomeTaxRate: decimalString("0"),
  monthlyStockSalesExemption: centavos(0),
};

function stockCandle(session: string, open: string, close: string, tradedQuantity = 1000): Candle {
  return {
    ticker: "PETR4",
    timeframe: "D1",
    session,
    asOf: `${session}T21:00:00.000Z`,
    open: decimalString(open),
    high: decimalString(close),
    low: decimalString(open),
    close: decimalString(close),
    tradedQuantity,
  };
}

function stockOperation(overrides: Partial<Operation> = {}): Operation {
  return {
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
    ...overrides,
  };
}

const baseInput: ScoreInput = {
  view: emptyView,
  subject: "hold",
  decidedAt: "2024-01-01T14:00:00.000Z",
  horizon: "2024-01-05",
  confidence: confidence("0.6"),
  claim: null,
  realizedFills: [],
  origin: { kind: "manual" },
  costModel: zeroCostModel,
};

describe("score — pnl with a realized fill plus the remaining quantity marked to the horizon close", () => {
  const view: MarketView = {
    ...emptyView,
    candles: [stockCandle("2024-01-05", "13.00", "13.00")],
  };

  const realizedFill: Fill = {
    ticker: "PETR4",
    side: "sell",
    quantity: quantity(40),
    price: decimalString("12.00"),
    session: "2024-01-03",
    at: "2024-01-03T15:00:00.000Z",
    costs: centavos(50),
  };

  it.each(["enter", "hold", "adjust", "exit"] as const)(
    "computes pnl, maxLoss and normalizedPnl for a %s decision the same way",
    (subject) => {
      const result = score(
        { ...baseInput, view, subject, operation: stockOperation(), realizedFills: [realizedFill] },
        provenanceBase,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // fill: (12.00 - 10.00) * 100 * 40 - 50 = 7950
      // mark: (13.00 - 10.00) * 100 * 60 = 18000
      expect(result.value.pnl).toBe(centavos(25_950));
      expect(result.value.maxLoss).toBe(centavos(100_000));
      expect(result.value.normalizedPnl).toBe(decimalString("0.259500"));
      expect(result.value.thesis).toEqual({ claim: null });
      expect(result.value.notes).toContainEqual(
        expect.objectContaining({ code: "no_thesis_claim" }),
      );
    },
  );
});

describe("score — do_not_enter", () => {
  it("scores pnl as zero and derives maxLoss/normalizedPnl from the untaken operation", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const result = score(
      { ...baseInput, view, subject: "do_not_enter", operation: stockOperation() },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pnl).toBe(centavos(0));
    expect(result.value.maxLoss).toBe(centavos(100_000));
    expect(result.value.normalizedPnl).toBe(decimalString("0.000000"));
  });

  it("rejects realizedFills alongside do_not_enter", () => {
    const result = score(
      {
        ...baseInput,
        subject: "do_not_enter",
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(10),
            price: decimalString("10.00"),
            session: "2024-01-03",
            at: "2024-01-03T15:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills",
      message: "do_not_enter must not carry realized fills; nothing was held",
    });
  });

  it("counterfactualPnl is null with a missed_entry note when no fill opportunity exists before the horizon", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [],
      quotes: [
        {
          ticker: "PETR4",
          asOf: "2024-01-01T21:00:00.000Z",
          last: decimalString("10.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = score(
      {
        ...baseInput,
        view,
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "manual" },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counterfactualPnl).toBeNull();
    expect(result.value.notes).toContainEqual(expect.objectContaining({ code: "missed_entry" }));
  });

  it("marks the counterfactual to the horizon close for a manual origin", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        stockCandle("2024-01-02", "10.00", "10.00"),
        stockCandle("2024-01-05", "13.00", "13.00"),
      ],
    };
    const result = score(
      {
        ...baseInput,
        view,
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "manual" },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // entry fill at the session-2 open (10.00), marked at the horizon close (13.00): (13-10)*100*100
    expect(result.value.counterfactualPnl).toBe(centavos(30_000));
  });

  const alwaysTrue: Condition = {
    kind: "compare",
    left: { kind: "price", field: "close" },
    comparator: ">",
    right: { kind: "constant", value: decimalString("0") },
  };

  const stockStructure: Structure = {
    id: "stock",
    name: "Stock",
    expiry: "shared",
    legs: [{ role: "stock", side: "buy", ratio: 1 }],
  };

  function strategyDefinition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
    return {
      name: "test",
      timeframe: "D1",
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
      entry: alwaysTrue,
      exit: [],
      adjustments: [],
      ...overrides,
    };
  }

  const strategy: StrategyVersion = {
    id: "v1",
    definition: strategyDefinition(),
    structure: stockStructure,
  };

  it("marks the counterfactual to the horizon close for a signal origin with no exit rule ever firing", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        stockCandle("2024-01-02", "10.00", "10.00"),
        stockCandle("2024-01-03", "10.00", "10.00"),
        stockCandle("2024-01-04", "10.00", "10.00"),
        stockCandle("2024-01-05", "13.00", "13.00"),
      ],
    };
    const result = score(
      {
        ...baseInput,
        view,
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "signal", strategy },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counterfactualPnl).toBe(centavos(30_000));
  });

  it("realizes the counterfactual net of costs when the strategy's exit rule fires and fills before the horizon", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        stockCandle("2024-01-02", "10.00", "10.00"),
        stockCandle("2024-01-03", "10.00", "10.00"),
        stockCandle("2024-01-04", "10.00", "10.00"),
        stockCandle("2024-01-05", "10.00", "16.00"),
        stockCandle("2024-01-06", "16.00", "16.00"),
      ],
    };
    const strategyWithExit: StrategyVersion = {
      id: "v1",
      definition: strategyDefinition({
        exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
      }),
      structure: stockStructure,
    };
    const result = score(
      {
        ...baseInput,
        view,
        horizon: "2024-01-06",
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "signal", strategy: strategyWithExit },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // entry fills at the session-2 open (10.00); the exit rule fires at the session-5 close
    // (16.00, a 60% gain past the 50% profit target) and fills at the session-6 open (16.00).
    expect(result.value.counterfactualPnl).toBe(centavos(60_000));
  });
});

describe("score — thesis claim", () => {
  it("close_above holds when the horizon close is strictly greater than the level", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const claim: ThesisClaim = {
      kind: "close_above",
      instrument: "PETR4",
      level: decimalString("12.50"),
    };
    const result = score(
      { ...baseInput, view, claim, confidence: confidence("0.7") },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thesis).toEqual({ claim, held: true, brier: decimalString("0.090000") });
  });

  it("close_below does not hold when the horizon close is not strictly less than the level", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const claim: ThesisClaim = {
      kind: "close_below",
      instrument: "PETR4",
      level: decimalString("10.00"),
    };
    const result = score(
      { ...baseInput, view, claim, confidence: confidence("0.7") },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thesis).toEqual({ claim, held: false, brier: decimalString("0.490000") });
  });

  it("operation_pnl_positive holds when the operation's realized pnl is positive", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const claim: ThesisClaim = { kind: "operation_pnl_positive" };
    const result = score(
      {
        ...baseInput,
        view,
        claim,
        operation: stockOperation(),
        confidence: confidence("0.7"),
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thesis).toMatchObject({ claim, held: true });
  });

  it("operation_pnl_positive on a do_not_enter decision uses the counterfactual pnl, not the (always zero) realized pnl", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        stockCandle("2024-01-02", "10.00", "10.00"),
        stockCandle("2024-01-05", "13.00", "13.00"),
      ],
    };
    const claim: ThesisClaim = { kind: "operation_pnl_positive" };
    const result = score(
      {
        ...baseInput,
        view,
        claim,
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "manual" },
        confidence: confidence("0.7"),
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pnl).toBe(centavos(0));
    expect(result.value.counterfactualPnl).toBe(centavos(30_000));
    expect(result.value.thesis).toMatchObject({ claim, held: true });
  });

  it("operation_pnl_positive without an operation is invalid_input at path claim", () => {
    const result = score(
      { ...baseInput, claim: { kind: "operation_pnl_positive" } },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "claim",
      message: "operation_pnl_positive needs an operation to score against",
    });
  });

  it("no claim scores { claim: null } with a no_thesis_claim note", () => {
    const result = score(baseInput, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thesis).toEqual({ claim: null });
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "no_thesis_claim" }),
    );
  });

  it("a missing horizon candle for the claim instrument is insufficient_data", () => {
    const claim: ThesisClaim = {
      kind: "close_above",
      instrument: "VALE3",
      level: decimalString("10.00"),
    };
    const result = score({ ...baseInput, claim }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });
});

describe("score — no operation (ADR-0014 Q46)", () => {
  it("scores an analysis (no operation) on the thesis claim alone", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const claim: ThesisClaim = {
      kind: "close_above",
      instrument: "PETR4",
      level: decimalString("12.00"),
    };
    const result = score(
      { ...baseInput, view, claim, subject: "analysis" },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pnl).toBeNull();
    expect(result.value.maxLoss).toBeNull();
    expect(result.value.normalizedPnl).toBeNull();
    expect(result.value.counterfactualPnl).toBeNull();
    expect(result.value.thesis).toMatchObject({ claim, held: true });
    expect(result.value.notes).toContainEqual(expect.objectContaining({ code: "no_operation" }));
  });

  it("rejects non-empty realizedFills when there is no operation", () => {
    const result = score(
      {
        ...baseInput,
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(10),
            price: decimalString("10.00"),
            session: "2024-01-03",
            at: "2024-01-03T15:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills",
      message: "realizedFills must be empty without an operation",
    });
  });
});

describe("score — max loss shapes", () => {
  const callSeries: OptionSeries = {
    ticker: "PETR4C28",
    underlying: "PETR4",
    right: "call",
    strike: decimalString("28.00"),
    expiry: "2024-02-01",
    style: "european",
    asOf: "2024-01-01T00:00:00.000Z",
  };

  it("reports unbounded max loss for a naked short call", () => {
    const view: MarketView = {
      ...emptyView,
      optionSeries: [callSeries],
      candles: [stockCandle("2024-01-05", "20.00", "20.00")],
    };
    const nakedShortCall: Operation = {
      id: "op-2",
      underlying: "PETR4",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(100),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-02-01",
      openedAt: "2024-01-01",
      strategyVersionId: null,
      rolledFrom: null,
    };
    const result = score(
      { ...baseInput, view, operation: nakedShortCall },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxLoss).toBe("unbounded");
    expect(result.value.normalizedPnl).toBeNull();
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "unbounded_max_loss" }),
    );
  });

  it("reports zero max loss and a zero_max_loss note for a costless stock leg", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const freeStock = stockOperation({
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("0.00"),
        },
      ],
    });
    const result = score({ ...baseInput, view, operation: freeStock }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxLoss).toBe(centavos(0));
    expect(result.value.normalizedPnl).toBeNull();
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "zero_max_loss" }),
    );
  });
});

describe("score — invalid inputs", () => {
  it("rejects a horizon outside the calendar", () => {
    const result = score({ ...baseInput, horizon: "2024-02-01" }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "horizon",
      message: "the horizon session is not in the calendar",
    });
  });

  it("rejects a decidedAt not covered by any calendar session", () => {
    const result = score(
      { ...baseInput, decidedAt: "2023-12-01T00:00:00.000Z" },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "decidedAt",
      message: "no calendar session covers decidedAt",
    });
  });

  it("rejects a horizon before the session of decidedAt", () => {
    const result = score(
      { ...baseInput, decidedAt: "2024-01-05T14:00:00.000Z", horizon: "2024-01-02" },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "horizon",
      message: "the horizon must not be before the session of decidedAt",
    });
  });

  const view: MarketView = {
    ...emptyView,
    candles: [stockCandle("2024-01-05", "13.00", "13.00")],
  };

  it("rejects a realized fill at or before decidedAt", () => {
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(10),
            price: decimalString("11.00"),
            session: "2024-01-01",
            at: "2024-01-01T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills[0].at",
      message: "a realized fill must be after decidedAt",
    });
  });

  it("rejects a realized fill after the horizon close", () => {
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(10),
            price: decimalString("11.00"),
            session: "2024-01-06",
            at: "2024-01-06T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills[0].at",
      message: "a realized fill must be at or before the horizon close",
    });
  });

  it("rejects a realized fill whose ticker matches no operation leg", () => {
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "VALE3",
            side: "sell",
            quantity: quantity(10),
            price: decimalString("11.00"),
            session: "2024-01-03",
            at: "2024-01-03T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills[0].ticker",
      message: "no operation leg matches this fill's ticker",
    });
  });

  it("rejects a realized fill on the same side as its leg (not closing it)", () => {
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "buy",
            quantity: quantity(10),
            price: decimalString("11.00"),
            session: "2024-01-03",
            at: "2024-01-03T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills[0].side",
      message: "a realized fill must close its leg (opposite side)",
    });
  });

  it("rejects realized fills that close more than the leg's own quantity", () => {
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(60),
            price: decimalString("11.00"),
            session: "2024-01-03",
            at: "2024-01-03T14:00:00.000Z",
            costs: centavos(0),
          },
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(60),
            price: decimalString("11.00"),
            session: "2024-01-04",
            at: "2024-01-04T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "realizedFills[1].quantity",
      message: "realized fills close more than the leg's quantity",
    });
  });
});

describe("score — split-factor rebasing (ADR-0014 Q51)", () => {
  it("rebases pnl and maxLoss by the split factor between openedAt and the horizon", () => {
    const view: MarketView = {
      ...emptyView,
      corporateActions: [
        { ticker: "PETR4", exDate: "2024-01-03", asOf: "2024-01-03T00:00:00.000Z", factor: decimalString("0.5") },
      ],
      candles: [stockCandle("2024-01-05", "6.50", "6.50")],
    };
    const result = score(
      { ...baseInput, view, operation: stockOperation() },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // effective quantity 200 @ effective entry 5.00; mark 6.50: (6.50-5.00)*100*200
    expect(result.value.pnl).toBe(centavos(30_000));
    expect(result.value.maxLoss).toBe(centavos(100_000));
    expect(result.value.normalizedPnl).toBe(decimalString("0.300000"));
  });

  it("propagates a non-positive corporate-action factor as invalid_input", () => {
    const view: MarketView = {
      ...emptyView,
      corporateActions: [
        { ticker: "PETR4", exDate: "2024-01-03", asOf: "2024-01-03T00:00:00.000Z", factor: decimalString("0") },
      ],
      candles: [stockCandle("2024-01-05", "13.00", "13.00")],
    };
    const result = score(
      { ...baseInput, view, operation: stockOperation() },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "corporateActions[].factor",
      message: "a corporate-action factor must be positive",
    });
  });

  it("rejects a corporate-action factor keyed by a non-stock leg's own ticker that dissolves it below one effective unit", () => {
    const callSeries: OptionSeries = {
      ticker: "PETR4C28",
      underlying: "PETR4",
      right: "call",
      strike: decimalString("28.00"),
      expiry: "2024-02-01",
      style: "european",
      asOf: "2024-01-01T00:00:00.000Z",
    };
    const view: MarketView = {
      ...emptyView,
      optionSeries: [callSeries],
      corporateActions: [
        {
          ticker: "PETR4C28",
          exDate: "2024-01-03",
          asOf: "2024-01-03T00:00:00.000Z",
          factor: decimalString("1000"),
        },
      ],
      candles: [stockCandle("2024-01-05", "20.00", "20.00")],
    };
    const operation: Operation = {
      id: "op-2",
      underlying: "PETR4",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(100),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-02-01",
      openedAt: "2024-01-01",
      strategyVersionId: null,
      rolledFrom: null,
    };
    const result = score({ ...baseInput, view, operation }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operation.legs[0]",
      message: "a corporate-action factor dissolves a non-stock leg below one effective unit",
    });
  });
});

describe("score — leg fully closed by realized fills", () => {
  it("marks nothing to the horizon close once realized fills close the whole leg", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "999.00", "999.00")],
    };
    const result = score(
      {
        ...baseInput,
        view,
        operation: stockOperation(),
        realizedFills: [
          {
            ticker: "PETR4",
            side: "sell",
            quantity: quantity(100),
            price: decimalString("11.00"),
            session: "2024-01-03",
            at: "2024-01-03T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (11.00 - 10.00) * 100 * 100, the out-of-range horizon close never read
    expect(result.value.pnl).toBe(centavos(10_000));
  });
});

describe("score — missing market data for max loss", () => {
  it("is missing_instrument when the underlying has no spot at the horizon close", () => {
    const result = score({ ...baseInput, operation: stockOperation() }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4" });
  });

  it("is missing_instrument when an option leg's series cannot be resolved", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "20.00", "20.00")],
    };
    const operation: Operation = {
      id: "op-2",
      underlying: "PETR4",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(100),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-02-01",
      openedAt: "2024-01-01",
      strategyVersionId: null,
      rolledFrom: null,
    };
    const result = score({ ...baseInput, view, operation }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4C28" });
  });
});

describe("score — thesis basis from a missed counterfactual", () => {
  it("is insufficient_data for operation_pnl_positive when do_not_enter never gets a counterfactual fill", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [],
      quotes: [
        {
          ticker: "PETR4",
          asOf: "2024-01-01T21:00:00.000Z",
          last: decimalString("10.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = score(
      {
        ...baseInput,
        view,
        subject: "do_not_enter",
        operation: stockOperation(),
        claim: { kind: "operation_pnl_positive" },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });
});

describe("score — remaining coverage: view integrity, coherence, short legs, unresolved exits", () => {
  it("propagates a view-integrity error (duplicate calendar date)", () => {
    const view: MarketView = {
      ...emptyView,
      calendar: [...calendar, calendar[0] as (typeof calendar)[number]],
    };
    const result = score({ ...baseInput, view, operation: stockOperation() }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("propagates an operation-coherence error (a stock leg's ticker must match the underlying)", () => {
    const badOperation = stockOperation({
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    const result = score({ ...baseInput, operation: badOperation }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("computes pnl for a short stock leg closed partly by a realized fill", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [stockCandle("2024-01-05", "9.00", "9.00")],
    };
    const shortOperation = stockOperation({
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    const result = score(
      {
        ...baseInput,
        view,
        operation: shortOperation,
        realizedFills: [
          {
            ticker: "PETR4",
            side: "buy",
            quantity: quantity(40),
            price: decimalString("8.00"),
            session: "2024-01-03",
            at: "2024-01-03T14:00:00.000Z",
            costs: centavos(0),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // fill: (8.00-10.00)*(-1)*100*40 = 8000; remaining: (9.00-10.00)*(-1)*100*60 = 6000
    expect(result.value.pnl).toBe(centavos(14_000));
  });

  it("marks the counterfactual to the horizon close when the exit signal fires but cannot fill before the horizon", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        stockCandle("2024-01-02", "10.00", "10.00"),
        stockCandle("2024-01-03", "10.00", "10.00"),
        stockCandle("2024-01-04", "10.00", "10.00"),
        stockCandle("2024-01-05", "10.00", "16.00"),
      ],
    };
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const stockStructure: Structure = {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    };
    const strategyWithExit: StrategyVersion = {
      id: "v1",
      definition: {
        name: "test",
        timeframe: "D1",
        structureId: "stock",
        strikes: [],
        sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        entry: alwaysTrue,
        exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
        adjustments: [],
      },
      structure: stockStructure,
    };
    const result = score(
      {
        ...baseInput,
        view,
        horizon: "2024-01-05",
        subject: "do_not_enter",
        operation: stockOperation(),
        origin: { kind: "signal", strategy: strategyWithExit },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // exit fires at the session-5 close but there is no later session to fill it before the
    // horizon; the position is marked to the horizon close (16.00) instead.
    expect(result.value.counterfactualPnl).toBe(centavos(60_000));
  });
});

describe("score — Brier score bounds (property)", () => {
  it("is always within [0, 1] for any confidence in [0, 1] and either claim outcome", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.boolean(),
        (confidenceMicros, wantHeld) => {
          const confidenceValue = confidenceMicros / 1_000_000;
          const view: MarketView = {
            ...emptyView,
            candles: [stockCandle("2024-01-05", "13.00", "13.00")],
          };
          const claim: ThesisClaim = wantHeld
            ? { kind: "close_above", instrument: "PETR4", level: decimalString("12.00") }
            : { kind: "close_below", instrument: "PETR4", level: decimalString("12.00") };
          const result = score(
            { ...baseInput, view, claim, confidence: confidence(confidenceValue.toFixed(6)) },
            provenanceBase,
          );
          if (!result.ok || result.value.thesis.claim === null) throw new Error("expected a scored claim");
          const brier = Number(result.value.thesis.brier);
          expect(brier).toBeGreaterThanOrEqual(0);
          expect(brier).toBeLessThanOrEqual(1);
          expect(result.value.thesis.held).toBe(wantHeld);
        },
      ),
    );
  });
});
