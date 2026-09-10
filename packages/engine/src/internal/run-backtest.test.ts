import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  CorporateActionFactor,
  MarketView,
  RunBacktestInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import { runBacktest } from "./run-backtest";

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

function session(date: string): TradingSession {
  return { date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` };
}

function candle(
  ticker: string,
  date: string,
  open: string,
  close: string,
  tradedQuantity = 1000,
): Candle {
  return {
    ticker,
    timeframe: "D1",
    session: date,
    asOf: `${date}T20:00:00.000Z`,
    open: decimalString(open),
    high: decimalString(close > open ? close : open),
    low: decimalString(close < open ? close : open),
    close: decimalString(close),
    tradedQuantity,
  };
}

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
};

const closeAbove9: Condition = {
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "constant", value: decimalString("9") },
};

function definition(
  overrides: Partial<StrategyDefinition> & Pick<StrategyDefinition, "entry">,
): StrategyDefinition {
  return {
    name: "test",
    timeframe: "D1",
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [],
    adjustments: [],
    ...overrides,
  };
}

function strategyVersion(
  def: StrategyDefinition,
  structure: Structure = stockStructure,
): StrategyVersion {
  return { id: "v1", definition: def, structure };
}

const generousRiskProfile = {
  declaredCapital: centavos(10_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 5,
    maxPremiumBought: decimalString("1"),
  },
};

function baseConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    strategy: strategyVersion(definition({ entry: closeAbove9 })),
    universe: ["PETR4"],
    period: { from: "2024-01-02", to: "2024-01-05" },
    initialCapital: centavos(10_000_00),
    costModel: {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(0) },
      optionSlippageRate: decimalString("0"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    },
    riskProfile: generousRiskProfile,
    limits: "enforce",
    sizing: null,
    walkForward: null,
    seed: 1,
    ...overrides,
  };
}

const fourSessionCalendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);

function businessDays(count: number, startingFrom = new Date(Date.UTC(2024, 0, 2))): string[] {
  const dates: string[] = [];
  const cursor = new Date(startingFrom);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

describe("runBacktest — hand-computed fills, costs, taxes and metrics", () => {
  it("fills at the next session's open, charges costs, exits on profit_target, taxes an exempt month, refuses annualization under 126 sessions", () => {
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
        }),
      ),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "11.00", "12.00"),
        candle("PETR4", "2024-01-05", "12.50", "12.50"),
      ],
    };
    const input: RunBacktestInput = { view, config };
    const result = runBacktest(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.status !== "complete") throw new Error("expected a complete run");
    const { run } = result.value;

    expect(run.fills).toEqual([
      {
        ticker: "PETR4",
        side: "buy",
        quantity: quantity(500),
        price: decimalString("10.00"),
        session: "2024-01-03",
        at: "2024-01-03T13:00:00.000Z",
        costs: centavos(350),
        operationId: run.fills[0]?.operationId,
        source: "next_session_open",
      },
      {
        ticker: "PETR4",
        side: "sell",
        quantity: quantity(500),
        price: decimalString("12.50"),
        session: "2024-01-05",
        at: "2024-01-05T13:00:00.000Z",
        costs: centavos(413),
        operationId: run.fills[0]?.operationId,
        source: "next_session_open",
      },
    ]);

    expect(run.operations).toHaveLength(1);
    const op = run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.closeReason.kind).toBe("exit_rule");
    expect(op.pnl).toBe(centavos(124_237));

    expect(run.equityCurve).toEqual([
      {
        session: "2024-01-02",
        equity: centavos(1_000_000),
        cash: centavos(1_000_000),
        drawdown: decimalString("0.000000"),
      },
      {
        session: "2024-01-03",
        equity: centavos(999_650),
        cash: centavos(499_650),
        drawdown: decimalString("0.000350"),
      },
      {
        session: "2024-01-04",
        equity: centavos(1_099_650),
        cash: centavos(499_650),
        drawdown: decimalString("0.000000"),
      },
      {
        session: "2024-01-05",
        equity: centavos(1_124_237),
        cash: centavos(1_124_237),
        drawdown: decimalString("0.000000"),
      },
    ]);

    expect(run.taxes).toEqual([
      {
        month: "2024-01",
        stockSales: centavos(625_000),
        stockGain: centavos(124_237),
        optionGain: centavos(0),
        exemptGain: centavos(124_237),
        netGain: centavos(0),
        tax: centavos(0),
      },
    ]);

    expect(run.metrics.sessions).toBe(4);
    expect(run.metrics.totalReturn).toBe(decimalString("0.124237"));
    expect(run.metrics.maxDrawdown).toBe(decimalString("0.000350"));
    expect(run.metrics.exposure).toBe(decimalString("0.500000"));
    expect(run.metrics.winRate).toBe(decimalString("1.000000"));
    expect(run.metrics.profitFactor).toBeNull();
    expect(run.metrics.cagr).toBeNull();
    expect(run.metrics.sharpe).toBeNull();
    expect(run.metrics.fees).toBe(centavos(350 + 413));
    expect(run.metrics.taxes).toBe(centavos(0));
    expect(run.notes).toEqual([
      {
        code: "short_window_not_annualized",
        message: "fewer than 126 sessions; cagr and sharpe are not annualized",
      },
    ]);
  });

  it("charges costs even when the fee rate is zero (brokerage alone) — costs are always charged", () => {
    const config = baseConfig({
      costModel: {
        b3FeeRate: decimalString("0"),
        brokerage: { stockPerOrder: centavos(150), optionPerContract: centavos(0) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
      period: { from: "2024-01-02", to: "2024-01-03" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]?.costs).toBe(centavos(150));
  });

  it("taxes a non-exempt month at 15% of the net stock gain", () => {
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.01") }],
        }),
      ),
      initialCapital: centavos(30_000_000_00),
      riskProfile: { ...generousRiskProfile, declaredCapital: centavos(30_000_000_00) },
      costModel: {
        b3FeeRate: decimalString("0"),
        brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "11.00", "11.00"),
        candle("PETR4", "2024-01-05", "11.00", "11.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const tax = result.value.run.taxes[0];
    expect(tax?.stockSales).toBeGreaterThan(2_000_000_00);
    expect(tax?.exemptGain).toBe(centavos(0));
    expect(tax?.tax).toBe(centavos(Math.round((tax?.netGain ?? 0) * 0.15)));
    expect(tax?.tax).toBeGreaterThan(0);
  });
});

describe("runBacktest — missed entries", () => {
  it("retries a missed fill up to three sessions then records a MissedEntry with reason no_trades", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"].map(
      session,
    );
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-08" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00", 0),
        candle("PETR4", "2024-01-04", "10.00", "10.00", 0),
        candle("PETR4", "2024-01-05", "10.00", "10.00", 0),
        candle("PETR4", "2024-01-08", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toEqual([]);
    expect(result.value.run.missedEntries).toHaveLength(1);
    expect(result.value.run.missedEntries[0]).toEqual({
      ticker: "PETR4",
      signalAt: result.value.run.missedEntries[0]?.signalAt,
      sessionsTried: 3,
      reason: "no_trades",
    });
  });

  it("finalizes a missed entry early once the entry condition stops holding", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "5.00", 0),
        candle("PETR4", "2024-01-04", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.missedEntries).toHaveLength(1);
    expect(result.value.run.missedEntries[0]?.sessionsTried).toBe(1);
    expect(result.value.run.missedEntries[0]?.reason).toBe("no_trades");
  });

  it("finalizes a stranded pending entry when the period ends before a retry can be attempted", () => {
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00", 0),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.missedEntries).toHaveLength(1);
    expect(result.value.run.missedEntries[0]?.sessionsTried).toBe(1);
  });
});

describe("runBacktest — limits", () => {
  const tightRiskProfile = {
    declaredCapital: centavos(10_000_00),
    limits: {
      maxLossPerOperation: decimalString("0.0001"),
      maxExposurePerOperation: decimalString("1"),
      maxOpenOperations: 5,
      maxPremiumBought: decimalString("1"),
    },
  };

  it("refuses a breaching entry under enforce mode and records a MissedEntry with reason limit_breach", () => {
    const config = baseConfig({
      period: { from: "2024-01-02", to: "2024-01-03" },
      riskProfile: tightRiskProfile,
      limits: "enforce",
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toEqual([]);
    expect(result.value.run.missedEntries[0]?.reason).toBe("limit_breach");
  });

  it("fills a breaching entry under warn mode and records the breach in limitBreaches", () => {
    const config = baseConfig({
      period: { from: "2024-01-02", to: "2024-01-03" },
      riskProfile: tightRiskProfile,
      limits: "warn",
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toHaveLength(1);
    expect(result.value.run.limitBreaches).toHaveLength(1);
    expect(result.value.run.limitBreaches[0]?.ticker).toBe("PETR4");
    expect(result.value.run.limitBreaches[0]?.session).toBe("2024-01-03");
    expect(result.value.run.notes).toContainEqual({
      code: "limit_breach_warned",
      message: "the run filled at least one entry that breached the risk profile under warn mode",
    });
  });

  const maxTwoOpenRiskProfile = {
    declaredCapital: centavos(10_000_00),
    limits: {
      maxLossPerOperation: decimalString("1"),
      maxExposurePerOperation: decimalString("1"),
      maxOpenOperations: 2,
      maxPremiumBought: decimalString("1"),
    },
  };

  it("re-checks maxOpenOperations at fill time across same-session fills, refusing the excess in enforce mode", () => {
    const config = baseConfig({
      universe: ["AAAA4", "BBBB4", "CCCC4"],
      period: { from: "2024-01-02", to: "2024-01-03" },
      riskProfile: maxTwoOpenRiskProfile,
      limits: "enforce",
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("AAAA4", "2024-01-02", "10.00", "10.00"),
        candle("AAAA4", "2024-01-03", "10.00", "10.00"),
        candle("BBBB4", "2024-01-02", "10.00", "10.00"),
        candle("BBBB4", "2024-01-03", "10.00", "10.00"),
        candle("CCCC4", "2024-01-02", "10.00", "10.00"),
        candle("CCCC4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toHaveLength(2);
    expect(result.value.run.missedEntries).toHaveLength(1);
    expect(result.value.run.missedEntries[0]).toMatchObject({
      ticker: "CCCC4",
      reason: "limit_breach",
    });
  });

  it("re-checks maxOpenOperations at fill time across same-session fills, filling and warning on the excess in warn mode", () => {
    const config = baseConfig({
      universe: ["AAAA4", "BBBB4", "CCCC4"],
      period: { from: "2024-01-02", to: "2024-01-03" },
      riskProfile: maxTwoOpenRiskProfile,
      limits: "warn",
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("AAAA4", "2024-01-02", "10.00", "10.00"),
        candle("AAAA4", "2024-01-03", "10.00", "10.00"),
        candle("BBBB4", "2024-01-02", "10.00", "10.00"),
        candle("BBBB4", "2024-01-03", "10.00", "10.00"),
        candle("CCCC4", "2024-01-02", "10.00", "10.00"),
        candle("CCCC4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toHaveLength(3);
    expect(result.value.run.missedEntries).toHaveLength(0);
    expect(result.value.run.limitBreaches).toHaveLength(1);
    expect(result.value.run.limitBreaches[0]).toMatchObject({
      ticker: "CCCC4",
      limit: "maxOpenOperations",
    });
  });
});

describe("runBacktest — period end", () => {
  it("closes a still-open operation at period end with reason period_end, excluded from winRate/profitFactor", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.operations).toHaveLength(1);
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.closeReason.kind).toBe("period_end");
    expect(result.value.run.metrics.operations).toBe(1);
    expect(result.value.run.metrics.winRate).toBeNull();
    expect(result.value.run.metrics.profitFactor).toBeNull();
  });

  it("sweeps and finalizes the last month's tax when period.to falls on a non-session day", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-07" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.operations).toHaveLength(1);
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.closeReason.kind).toBe("period_end");
    expect(op.closedAt).toBe("2024-01-03");
    expect(result.value.run.taxes).toHaveLength(1);
    expect(result.value.run.taxes[0]?.month).toBe("2024-01");
  });
});

describe("runBacktest — errors", () => {
  it("returns unsupported for a strategy with option legs", () => {
    const optionStructure: Structure = {
      id: "cc",
      name: "Covered call",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      ] as LegTemplate[],
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "cc",
          strikes: [{ kind: "moneyness", percent: decimalString("0.05") }],
          expiry: { kind: "business_days", min: 20, max: 45 },
        },
        optionStructure,
      ),
    });
    const result = runBacktest({ view: emptyView, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "unsupported",
      vocabulary: "strikeSelections",
      kind: "moneyness",
    });
  });

  it("returns invalid_input for a non-daily timeframe (v1 is daily-only, not an unimplemented capability)", () => {
    const config = baseConfig({
      strategy: strategyVersion(definition({ entry: closeAbove9, timeframe: "60m" })),
    });
    const result = runBacktest({ view: emptyView, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
    if (result.error.code !== "invalid_input") return;
    expect(result.error.path).toBe("config.strategy.definition.timeframe");
  });

  it("returns invalid_input for a non-positive or fractional maxSessions", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    for (const maxSessions of [0, -1, 1.5]) {
      const result = runBacktest({ view, config, maxSessions });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toEqual({
        code: "invalid_input",
        path: "maxSessions",
        message: "maxSessions must be a positive integer",
      });
    }
  });

  it("returns invalid_input for a non-positive or fractional walkForward.windowSessions", () => {
    const config = baseConfig({
      period: { from: "2024-01-02", to: "2024-01-03" },
      walkForward: { windowSessions: 0 },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "config.walkForward.windowSessions",
      message: "windowSessions must be a positive integer",
    });
  });

  it("returns invalid_input for a duplicate session date in view.calendar", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: [...fourSessionCalendar.slice(0, 2), session("2024-01-02")],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "view.calendar",
      message: "duplicate session 2024-01-02",
    });
  });

  it("returns invalid_input when the calendar has no session inside the period", () => {
    const config = baseConfig();
    const result = runBacktest({ view: emptyView, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns checkpoint_mismatch when the resume digest does not match the config", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({
      view,
      config,
      resume: {
        schema: 1,
        engineVersion: "0.1.0",
        configDigest: "deadbeef",
        cursor: "2024-01-02",
        state: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("checkpoint_mismatch");
  });
});

describe("runBacktest — corporate actions across an open position", () => {
  const split: CorporateActionFactor = {
    ticker: "PETR4",
    exDate: "2024-01-04",
    asOf: "2024-01-04T13:00:00.000Z",
    factor: decimalString("0.5"),
  };

  const distantUnrelatedFactor: CorporateActionFactor = {
    ticker: "PETR4",
    exDate: "2099-01-01",
    asOf: "2099-01-01T13:00:00.000Z",
    factor: decimalString("1"),
  };

  it("marks an open position on its post-split effective share count, no phantom drawdown", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split, distantUnrelatedFactor],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    // Entry: 500 shares at 10.00 on 2024-01-03. The ex-date factor 0.5 (a 2:1 split) makes the
    // effective holding 1000 shares at an entry price rebased to 5.00, so a mark at the
    // post-split nominal close of 5.00 is flat, not a phantom drawdown from pricing 500 shares
    // (the pre-split count) at the post-split price.
    const dayOfSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-04");
    const dayBeforeSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-03");
    expect(dayOfSplit?.equity).toBe(dayBeforeSplit?.equity);
  });

  it("exits an open position across a split at the effective (post-split) share count", () => {
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({ entry: closeAbove9, exit: [{ kind: "condition", condition: alwaysTrue }] }),
      ),
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "5.20", "5.20"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]).toMatchObject({
      side: "buy",
      quantity: quantity(500),
      price: decimalString("10.00"),
      session: "2024-01-03",
    });
    expect(result.value.run.fills[1]).toMatchObject({
      side: "sell",
      quantity: quantity(1000),
      price: decimalString("5.20"),
      session: "2024-01-04",
    });
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.closeReason.kind).toBe("exit_rule");
    expect(op.pnl).toBe(centavos(19_290));
  });

  it("never applies a factor whose asOf is not yet visible, even when its exDate is inside the run (I1)", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const lateSplit: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      // Ingested after the run's own period.to close: not yet visible to any mark this run
      // computes, even though its exDate falls squarely inside the run.
      asOf: "2024-01-05T00:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [lateSplit],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const dayOfSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-04");
    const dayBeforeSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-03");
    // Not adjusted: 500 nominal shares marked at the unadjusted 5.00 close is a real, not a
    // phantom, drawdown, because the split is not visible yet.
    expect(dayOfSplit?.equity).not.toBe(dayBeforeSplit?.equity);
    expect(result.value.run.provenance.truncated).toContainEqual({
      collection: "corporateActions",
      ticker: "PETR4",
      dropped: 1,
      reason: "after_at",
    });
  });

  it("3:1 grouping with a non-divisible share count: Σ op.pnl equals final cash minus initial capital", () => {
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const grouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("3"),
    };
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({ entry: closeAbove9, exit: [{ kind: "condition", condition: alwaysTrue }] }),
      ),
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [grouping],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        // Entry: 500 shares at 10.00 on 2024-01-03 — not divisible by the 3:1 grouping factor.
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "30.50", "30.50"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const finalCash = result.value.run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    const totalPnl = result.value.run.operations.reduce((sum, op) => sum + op.pnl, 0);
    expect(totalPnl).toBe(finalCash - config.initialCapital);
    expect(result.value.run.taxes.every((t) => t.tax === centavos(0))).toBe(true);
  });

  it("1:200 grouping rounds an open leg to zero effective shares without throwing", () => {
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const deepGrouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("200"),
    };
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({ entry: closeAbove9, exit: [{ kind: "condition", condition: alwaysTrue }] }),
      ),
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [deepGrouping],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        // Entry: 500 shares at 10.00 on 2024-01-03; 500 / 200 = 2.5 effective shares, floored
        // to 0 — the fill must be skipped, not throw, and the residue cash-settled.
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "2000.00", "2000.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
  });
});

describe("runBacktest — provenance", () => {
  it("reports rows after the period.to close as truncated", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "999.00", "999.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.provenance.truncated).toEqual([
      { collection: "candles", ticker: "PETR4", dropped: 1, reason: "after_at" },
    ]);
  });

  it("reports no truncation when every row is visible by the period's end", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.provenance.truncated).toEqual([]);
  });
});

describe("runBacktest — chunking and determinism", () => {
  const chunkingCalendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);
  const chunkingView: MarketView = {
    ...emptyView,
    calendar: chunkingCalendar,
    candles: [
      candle("PETR4", "2024-01-02", "10.00", "10.00"),
      candle("PETR4", "2024-01-03", "10.00", "10.00"),
      candle("PETR4", "2024-01-04", "11.00", "12.00"),
      candle("PETR4", "2024-01-05", "12.50", "12.50"),
    ],
  };
  const chunkingConfig = baseConfig({
    strategy: strategyVersion(
      definition({
        entry: closeAbove9,
        exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
      }),
    ),
  });

  it("is deterministic: identical inputs yield a deep-equal run (I4)", () => {
    const r1 = runBacktest({ view: chunkingView, config: chunkingConfig });
    const r2 = runBacktest({ view: chunkingView, config: chunkingConfig });
    expect(r1).toEqual(r2);
  });

  it("chunk-invariance: any maxSessions split reproduces the same run as one call (I2)", () => {
    const whole = runBacktest({ view: chunkingView, config: chunkingConfig });
    expect(whole.ok).toBe(true);
    if (!whole.ok || whole.value.status !== "complete") throw new Error("expected a complete run");

    let resume: RunBacktestInput["resume"] | undefined;
    let last: ReturnType<typeof runBacktest> | null = null;
    for (let iterations = 0; iterations < 10; iterations += 1) {
      const step = runBacktest(
        resume === undefined
          ? { view: chunkingView, config: chunkingConfig, maxSessions: 1 }
          : { view: chunkingView, config: chunkingConfig, maxSessions: 1, resume },
      );
      expect(step.ok).toBe(true);
      if (!step.ok) throw new Error("expected an ok result");
      last = step;
      if (step.value.status === "complete") break;
      resume = step.value.checkpoint;
    }
    expect(last?.ok).toBe(true);
    if (!last?.ok || last.value.status !== "complete")
      throw new Error("expected the chunked run to complete");
    expect(last.value.run).toEqual(whole.value.run);
  });

  it("prefix-consistency: a run stopped at session D agrees with the full run up to D (I7)", () => {
    const shortConfig = baseConfig({
      ...chunkingConfig,
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const shortResult = runBacktest({ view: chunkingView, config: shortConfig });
    const fullResult = runBacktest({ view: chunkingView, config: chunkingConfig });
    expect(shortResult.ok).toBe(true);
    expect(fullResult.ok).toBe(true);
    if (!shortResult.ok || shortResult.value.status !== "complete")
      throw new Error("expected complete");
    if (!fullResult.ok || fullResult.value.status !== "complete")
      throw new Error("expected complete");

    expect(shortResult.value.run.equityCurve).toEqual(fullResult.value.run.equityCurve.slice(0, 3));
    expect(shortResult.value.run.fills).toEqual(fullResult.value.run.fills.slice(0, 1));
    const shortOp = shortResult.value.run.operations[0];
    expect(shortOp?.status).toBe("closed");
    if (shortOp?.status !== "closed") throw new Error("expected a closed operation");
    expect(shortOp.closeReason).toEqual({ kind: "period_end" });
  });

  it("a chunked run over 126+ sessions with a non-zero CDI reports the same sharpe as one call (I2)", () => {
    const dates = businessDays(130);
    const calendar = dates.map(session);
    const candles = dates.map((date, i) =>
      candle("PETR4", date, "10.00", i % 2 === 0 ? "10.10" : "9.95"),
    );
    const config = baseConfig({
      strategy: strategyVersion(definition({ entry: closeAbove9 })),
      period: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles,
      macro: [
        {
          series: "cdi",
          date: "2024-01-01",
          asOf: "2024-01-01T21:00:00.000Z",
          annualRate: decimalString("0.10"),
        },
      ],
    };
    const whole = runBacktest({ view, config });
    expect(whole.ok).toBe(true);
    if (!whole.ok || whole.value.status !== "complete") throw new Error("expected complete");
    expect(whole.value.run.metrics.sharpe).not.toBeNull();

    let resume: RunBacktestInput["resume"] | undefined;
    let last: ReturnType<typeof runBacktest> | null = null;
    for (let iterations = 0; iterations < 20; iterations += 1) {
      const step = runBacktest(
        resume === undefined
          ? { view, config, maxSessions: 10 }
          : { view, config, maxSessions: 10, resume },
      );
      expect(step.ok).toBe(true);
      if (!step.ok) throw new Error("expected an ok result");
      last = step;
      if (step.value.status === "complete") break;
      resume = step.value.checkpoint;
    }
    if (!last?.ok || last.value.status !== "complete")
      throw new Error("expected the chunked run to complete");
    expect(last.value.run.metrics.sharpe).toEqual(whole.value.run.metrics.sharpe);
    expect(last.value.run.metrics.cagr).toEqual(whole.value.run.metrics.cagr);
  });
});

describe("runBacktest — tax deduction timing and month bookkeeping", () => {
  it("deducts a finalized month's tax on the last session of the following month, mid-run", () => {
    const calendar = [
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
      "2024-02-01",
      "2024-02-02",
      "2024-03-01",
    ].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
        }),
      ),
      period: { from: "2024-01-02", to: "2024-03-01" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "11.00", "12.00"),
        candle("PETR4", "2024-01-05", "12.50", "12.50"),
        candle("PETR4", "2024-02-01", "5.00", "5.00"),
        candle("PETR4", "2024-02-02", "5.00", "5.00"),
        candle("PETR4", "2024-03-01", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.taxes).toHaveLength(3);
    const jan = result.value.run.taxes.find((t) => t.month === "2024-01");
    expect(jan?.tax).toBe(centavos(0));
    const cashAt = (date: string) =>
      result.value.status === "complete"
        ? result.value.run.equityCurve.find((p) => p.session === date)?.cash
        : undefined;
    expect(cashAt("2024-02-02")).toBe(cashAt("2024-02-01"));
  });

  it("overrides the strategy's sizing rule with config.sizing when present", () => {
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          sizing: { kind: "fixed_fractional", fraction: decimalString("0.9") },
        }),
      ),
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      period: { from: "2024-01-02", to: "2024-01-03" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    // config.sizing (0.1) overrides the strategy's own 0.9: budget = 0.1 * 1_000_000 = 100_000
    // centavos; price 10.00 -> 1000 centavos/unit; units = floor(100_000 / 1000) = 100.
    expect(result.value.run.fills[0]?.quantity).toBe(quantity(100));
  });

  it("computes walk-forward windows next to the whole-run metrics", () => {
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
        }),
      ),
      walkForward: { windowSessions: 2 },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "11.00", "12.00"),
        candle("PETR4", "2024-01-05", "12.50", "12.50"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.walkForward).toHaveLength(2);
    expect(result.value.run.walkForward?.[0]).toMatchObject({
      from: "2024-01-02",
      to: "2024-01-03",
    });
    expect(result.value.run.walkForward?.[1]).toMatchObject({
      from: "2024-01-04",
      to: "2024-01-05",
    });
  });

  it("ignores candles of a different timeframe than the strategy's own", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        { ...candle("PETR4", "2024-01-03", "999.00", "999.00"), timeframe: "60m" },
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]?.price).toBe(decimalString("10.00"));
  });

  it("uses the visible CDI rate for the per-session risk-free rate", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      macro: [
        {
          series: "cdi",
          date: "2024-01-01",
          asOf: "2024-01-01T21:00:00.000Z",
          annualRate: decimalString("0.10"),
        },
      ],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected a run");
  });

  it("returns insufficient_data instead of throwing when a resumed view can't mark an open position", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const fullView: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const paused = runBacktest({ view: fullView, config, maxSessions: 2 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = { ...emptyView, calendar, candles: [] };
    const resumed = runBacktest({
      view: incompleteView,
      config,
      resume: paused.value.checkpoint,
    });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("insufficient_data");
  });

  it("returns checkpoint_mismatch when the resumed schema does not match", () => {
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const digest = runBacktest({ view, config });
    expect(digest.ok).toBe(true);
    if (!digest.ok || digest.value.status !== "complete") throw new Error("expected complete");
    const result = runBacktest({
      view,
      config,
      resume: {
        schema: 2 as never,
        engineVersion: "0.1.0",
        configDigest: digest.value.run.configDigest,
        cursor: "2024-01-02",
        state: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("checkpoint_mismatch");
    if (result.error.code !== "checkpoint_mismatch") return;
    expect(result.error.expectedDigest).toBe("schema:1");
    expect(result.error.receivedDigest).toBe("schema:2");
  });

  it("returns checkpoint_mismatch, distinguishable from a schema or digest mismatch, when the resumed engineVersion does not match", () => {
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const digest = runBacktest({ view, config });
    expect(digest.ok).toBe(true);
    if (!digest.ok || digest.value.status !== "complete") throw new Error("expected complete");
    const result = runBacktest({
      view,
      config,
      resume: {
        schema: 1,
        engineVersion: "0.0.1",
        configDigest: digest.value.run.configDigest,
        cursor: "2024-01-02",
        state: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("checkpoint_mismatch");
    if (result.error.code !== "checkpoint_mismatch") return;
    expect(result.error.expectedDigest).not.toBe(result.error.receivedDigest);
    expect(result.error.expectedDigest.startsWith("engineVersion:")).toBe(true);
    expect(result.error.receivedDigest).toBe("engineVersion:0.0.1");
  });

  it("returns checkpoint_mismatch when the resumed state's equity curve does not already cover the resume cursor", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const paused = runBacktest({ view, config, maxSessions: 1 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");
    const corruptedCheckpoint = {
      ...paused.value.checkpoint,
      state: {
        ...(paused.value.checkpoint.state as Record<string, unknown>),
        equityCurve: [],
      },
    };
    const result = runBacktest({ view, config, resume: corruptedCheckpoint });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("checkpoint_mismatch");
    if (result.error.code !== "checkpoint_mismatch") return;
    expect(result.error.expectedDigest).toBe("equityCurve.length:1");
    expect(result.error.receivedDigest).toBe("equityCurve.length:0");
  });

  it("returns invalid_input when resuming with a cursor that is not a session of the period", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const digest = runBacktest({ view, config });
    expect(digest.ok).toBe(true);
    if (!digest.ok || digest.value.status !== "complete") throw new Error("expected complete");
    const result = runBacktest({
      view,
      config,
      resume: {
        schema: 1,
        engineVersion: "0.1.0",
        configDigest: digest.value.run.configDigest,
        cursor: "1999-01-01",
        state: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "resume.cursor",
      message: "the checkpoint cursor is not a session of this period",
    });
  });

  it("finalizes a retry as unsizeable when sizing fails after a missed fill", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "999999.00", "999999.00", 0),
        candle("PETR4", "2024-01-04", "999999.00", "999999.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.missedEntries[0]?.reason).toBe("unsizeable");
  });

  it("marks an open position with the last known close when no candle trades on the mark session", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const lastPoint = result.value.run.equityCurve.at(-1);
    expect(lastPoint?.equity).toBe(result.value.run.equityCurve.at(-2)?.equity);
  });

  it("clamps a non-positive equity to a positive sizing budget instead of crashing", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({
      costModel: {
        b3FeeRate: decimalString("0"),
        brokerage: { stockPerOrder: centavos(5_000_000), optionPerContract: centavos(0) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const equityAfterEntry = result.value.run.equityCurve.find((p) => p.session === "2024-01-03");
    expect(equityAfterEntry?.equity).toBeLessThan(0);
    expect(equityAfterEntry?.cash).toBeLessThan(0);
    expect(result.value.run.notes).toContainEqual({
      code: "negative_cash",
      message: "cash went below zero during the run; v1 has no cash constraint",
    });
    expect(result.value.run.notes).toContainEqual({
      code: "non_positive_equity",
      message:
        "equity was non-positive at least once during the run and was clamped to a positive sizing budget",
    });
  });
});

describe("runBacktest — short stock legs, exit retries and error propagation", () => {
  const shortStructure: Structure = {
    id: "short-stock",
    name: "Short stock",
    expiry: "shared",
    legs: [{ role: "stock", side: "sell", ratio: 1 }] as LegTemplate[],
  };

  it("fills, marks and realizes pnl on a short (sell) stock leg", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          structureId: "short-stock",
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.05") }],
        }),
        shortStructure,
      ),
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "8.00", "8.00"),
        candle("PETR4", "2024-01-05", "7.50", "7.50"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]?.side).toBe("sell");
    expect(result.value.run.fills[1]?.side).toBe("buy");
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.pnl).toBeGreaterThan(0);
    const middlePoint = result.value.run.equityCurve.find((p) => p.session === "2024-01-04");
    expect(middlePoint?.equity).toBeGreaterThan(centavos(1_000_000));
  });

  it("counts a short entry's sell fill toward the month's stockSales, not only exit-side sells", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          structureId: "short-stock",
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.05") }],
        }),
        shortStructure,
      ),
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "8.00", "8.00"),
        candle("PETR4", "2024-01-05", "7.50", "7.50"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const entryFill = result.value.run.fills[0];
    expect(entryFill?.side).toBe("sell");
    const tax = result.value.run.taxes[0];
    expect(tax?.stockSales).toBe(
      centavos(Number(entryFill?.quantity) * Number(entryFill?.price) * 100),
    );
  });

  it("retries an exit fill across a zero-volume session without duplicating the pending exit", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
        }),
      ),
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "12.00", "12.00", 0),
        candle("PETR4", "2024-01-05", "12.50", "12.50"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toHaveLength(2);
    expect(result.value.run.fills[1]?.session).toBe("2024-01-05");
    expect(result.value.run.operations).toHaveLength(1);
  });

  it("propagates an evaluateStrategy invalid_input error (e.g. a corrupt macro rate)", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 2),
      macro: [
        {
          series: "cdi",
          date: "2024-01-01",
          asOf: "2024-01-01T21:00:00.000Z",
          annualRate: decimalString("-1"),
        },
      ],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("resolves the risk-free rate from several CDI points, skipping future ones", () => {
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar.slice(0, 3),
      macro: [
        {
          series: "cdi",
          date: "2024-01-03",
          asOf: "2024-01-03T21:00:00.000Z",
          annualRate: decimalString("0.11"),
        },
        {
          series: "cdi",
          date: "2024-01-10",
          asOf: "2024-01-10T21:00:00.000Z",
          annualRate: decimalString("0.20"),
        },
        {
          series: "cdi",
          date: "2024-01-01",
          asOf: "2024-01-01T21:00:00.000Z",
          annualRate: decimalString("0.10"),
        },
      ],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
  });

  it("finds the latest known close from out-of-order candles", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-04", "11.00", "11.00"),
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const last = result.value.run.equityCurve.at(-1);
    expect(last?.equity).toBeGreaterThan(centavos(1_000_000));
  });
});
