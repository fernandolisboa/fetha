import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  CorporateActionFactor,
  MarketView,
  OptionDayPrice,
  OptionSeries,
  RunBacktestInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { ENGINE_VERSION } from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import { computeBacktestMetrics } from "./backtest-metrics";
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
      brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
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

function callOrPutSeries(
  ticker: string,
  right: "call" | "put",
  strike: string,
  expiry: string,
  asOf: string,
): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf,
  };
}

function optionDayPrice(
  ticker: string,
  sessionDate: string,
  average: string,
  tradedQuantity = 10,
): OptionDayPrice {
  return {
    ticker,
    session: sessionDate,
    asOf: `${sessionDate}T20:00:00.000Z`,
    average: decimalString(average),
    close: decimalString(average),
    trades: 1,
    tradedQuantity,
  };
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
        brokerage: { stockPerOrder: centavos(150), optionPerOrder: centavos(0) },
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
        brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
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

  it("retries a fill attempt across a session with no candle at all for the ticker, not only a zero-volume one", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        // No candle at all for 2024-01-03 — a genuine gap in the ticker's history, distinct
        // from a session where a candle exists but trades zero volume.
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toEqual([expect.objectContaining({ session: "2024-01-04" })]);
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

  it("records a single maxOpenOperations breach in warn mode, not once from the signal and once from the fill-time re-check", () => {
    const maxOneOpenRiskProfile = {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 1,
        maxPremiumBought: decimalString("1"),
      },
    };
    const config = baseConfig({
      universe: ["AAAA4", "BBBB4"],
      period: { from: "2024-01-02", to: "2024-01-05" },
      riskProfile: maxOneOpenRiskProfile,
      limits: "warn",
    });
    const view: MarketView = {
      ...emptyView,
      calendar: fourSessionCalendar,
      candles: [
        candle("AAAA4", "2024-01-02", "10.00", "10.00"),
        candle("AAAA4", "2024-01-03", "10.00", "10.00"),
        candle("AAAA4", "2024-01-04", "10.00", "10.00"),
        candle("AAAA4", "2024-01-05", "10.00", "10.00"),
        // BBBB4 crosses the entry threshold only after AAAA4 is already open (filled at
        // 2024-01-03's open), so its signal at 2024-01-03's close is itself already breaching
        // (evaluateStrategy's own openOperationCount), and the fill-time re-check at
        // 2024-01-04's open sees the same breach again.
        candle("BBBB4", "2024-01-02", "5.00", "5.00"),
        candle("BBBB4", "2024-01-03", "10.00", "10.00"),
        candle("BBBB4", "2024-01-04", "10.00", "10.00"),
        candle("BBBB4", "2024-01-05", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const bbbbBreaches = result.value.run.limitBreaches.filter((b) => b.ticker === "BBBB4");
    expect(bbbbBreaches).toHaveLength(1);
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
  it("no longer refuses a strategy with option legs outright (#23): it fails the same way an empty view fails any strategy", () => {
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
      code: "invalid_input",
      path: "config.period",
      message: "no calendar session falls inside the requested period",
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
      message: "duplicate calendar date 2024-01-02",
    });
  });

  it("returns invalid_input instead of throwing when a resumed chunk's view carries two corporate-action rows sharing a (ticker, exDate)", () => {
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
    // Same upfront-validation rationale as the non-positive-factor case directly below: a
    // resumed chunk's own fills and marks read this session's view before `evaluateStrategy`
    // ever validates it, so the duplicate must be caught by `runBacktest`'s own upfront check.
    const duplicateFactors: CorporateActionFactor[] = [
      {
        ticker: "PETR4",
        exDate: "2024-01-04",
        asOf: "2024-01-04T13:00:00.000Z",
        factor: decimalString("0.5"),
      },
      {
        ticker: "PETR4",
        exDate: "2024-01-04",
        asOf: "2024-01-04T13:00:00.000Z",
        factor: decimalString("0.5"),
      },
    ];
    const invalidView: MarketView = { ...fullView, corporateActions: duplicateFactors };
    const resumed = runBacktest({
      view: invalidView,
      config,
      resume: paused.value.checkpoint,
    });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error).toEqual({
      code: "invalid_input",
      path: "view.corporateActions",
      message: "duplicate corporate action for PETR4|2024-01-04",
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
      // The engineVersion must actually match (ENGINE_VERSION, not a hardcoded literal
      // that could drift out of sync with it), or this test would pass
      // even with a broken configDigest check, short-circuiting on the version mismatch
      // instead of ever reaching it.
      resume: {
        schema: 1,
        engineVersion: ENGINE_VERSION,
        configDigest: "deadbeef",
        cursor: "2024-01-02",
        state: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("checkpoint_mismatch");
    if (result.error.code !== "checkpoint_mismatch") return;
    expect(result.error.receivedDigest).toBe("deadbeef");
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

  it.each([
    ["at the ex-date session's open", "2024-01-04T13:00:00.000Z", true],
    ["intraday on the ex-date session", "2024-01-04T16:00:00.000Z", true],
    ["at the ex-date session's close", "2024-01-04T20:00:00.000Z", true],
    ["after the ex-date session's close", "2024-01-05T00:00:00.000Z", false],
  ])(
    "reads the exit fill's split factor at the same instant as the candle it rebases: %s",
    (_label, asOf, factorApplies) => {
      const alwaysTrue: Condition = {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "constant", value: decimalString("0") },
      };
      const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
      const sweptSplit: CorporateActionFactor = { ...split, asOf };
      const config = baseConfig({
        strategy: strategyVersion(
          definition({ entry: closeAbove9, exit: [{ kind: "condition", condition: alwaysTrue }] }),
        ),
        period: { from: "2024-01-02", to: "2024-01-04" },
      });
      const view: MarketView = {
        ...emptyView,
        calendar,
        corporateActions: [sweptSplit],
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
      // The candle used for this exit fill (candleFor) is checked against this same session's
      // close; the factor must be checked at that identical instant, so a factor visible by
      // that close is applied to the fill exactly when it would also be applied to a same-session
      // mark of an operation that stayed open instead of exiting (I1, ADR-0014 Q51).
      expect(result.value.run.fills[1]).toMatchObject({
        quantity: factorApplies ? quantity(1000) : quantity(500),
      });
      const op = result.value.run.operations[0];
      if (op?.status !== "closed") throw new Error("expected a closed operation");
      expect(op.pnl).toBe(factorApplies ? centavos(19_290) : centavos(-240_580));
    },
  );

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

  it("1:1000 grouping rounds an open leg to zero effective shares without throwing", () => {
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
      factor: decimalString("1000"),
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
        // Entry: 500 shares at 10.00 on 2024-01-03; the effective post-grouping entry price
        // rebases to 10.00 * 1000 = 10,000.00, and 500 / 1000 = 0.5 effective shares, floored
        // to 0 — the fill is skipped (a single fill for the whole run, the entry), the residue
        // cash-settled, no shares traded on the exit.
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        // The rebased close exactly matches the rebased entry price (10,000.00), so the raw
        // price move nets to zero and the operation's pnl is exactly the entry's own costs
        // (b3FeeRate 0.0005 on a 5,000.00 gross plus the flat 100-centavo brokerage — 250 + 100
        // = 350 centavos), never rounded into a phantom share.
        candle("PETR4", "2024-01-04", "10000.00", "10000.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills).toHaveLength(1);
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.pnl).toBe(centavos(-350));
  });

  it("returns invalid_input, never throws, when a split factor blows the effective share count past a safe integer", () => {
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const microFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("0.000000000000001"),
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
      corporateActions: [microFactor],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input, never throws, when a near-zero factor reaches the mark on a zero-volume ex-date (#279)", () => {
    const microFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("0.000000000000001"),
    };
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [microFactor],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        // No volume on the ex-date: no fill runs first to refuse the factor, so the mark
        // multiplies a fresh price by the blown-up effective count.
        candle("PETR4", "2024-01-04", "10.00", "10.00", 0),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  // Issue #285: 500 shares / 1e-12 is a safe 5e14 effective units, but 5e14 x R$10.00 is 5e17
  // centavos, past a safe integer.
  const centavosOverflowFactor: CorporateActionFactor = {
    ticker: "PETR4",
    exDate: "2024-01-04",
    asOf: "2024-01-04T13:00:00.000Z",
    factor: decimalString("0.000000000001"),
  };

  it("returns invalid_input, never throws, when a factor leaves a safe unit count but overflows an exit fill's centavos (#285)", () => {
    const alwaysTrue: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    };
    const config = baseConfig({
      strategy: strategyVersion(
        definition({ entry: closeAbove9, exit: [{ kind: "condition", condition: alwaysTrue }] }),
      ),
      period: { from: "2024-01-02", to: "2024-01-04" },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: ["2024-01-02", "2024-01-03", "2024-01-04"].map(session),
      corporateActions: [centavosOverflowFactor],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        candle("PETR4", "2024-01-04", "10.00", "10.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  // Issue #344: each leg's own mark, 500 / 1e-10 = 5e12 units x R$10.00 = 5e15 centavos, is a
  // safe integer; the two operations' marks summed, 1e16, are not.
  it.each([
    ["the period-end sweep", "2024-01-04"],
    ["a mid-run equity point", "2024-01-05"],
  ])(
    "returns invalid_input, never throws, when every leg's mark is safe but their sum overflows at %s (#344)",
    (_, periodTo) => {
      const config = baseConfig({
        universe: ["PETR4", "VALE3"],
        period: { from: "2024-01-02", to: periodTo },
      });
      const factor = (ticker: string): CorporateActionFactor => ({
        ticker,
        exDate: "2024-01-04",
        asOf: "2024-01-04T13:00:00.000Z",
        factor: decimalString("0.0000000001"),
      });
      const candles = (ticker: string) => [
        candle(ticker, "2024-01-02", "10.00", "10.00"),
        candle(ticker, "2024-01-03", "10.00", "10.00"),
        candle(ticker, "2024-01-04", "10.00", "10.00", 0),
        candle(ticker, "2024-01-05", "10.00", "10.00", 0),
      ];
      const view: MarketView = {
        ...emptyView,
        calendar: fourSessionCalendar,
        corporateActions: [factor("PETR4"), factor("VALE3")],
        candles: [...candles("PETR4"), ...candles("VALE3")],
      };
      const result = runBacktest({ view, config });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatchObject({ code: "invalid_input", path: "view.corporateActions" });
    },
  );

  it.each([
    ["the period-end sweep", "2024-01-04"],
    ["a mid-run equity point", "2024-01-05"],
  ])(
    "returns invalid_input, never throws, when a factor leaves a safe unit count but overflows the mark's centavos at %s (#285)",
    (_, periodTo) => {
      const config = baseConfig({ period: { from: "2024-01-02", to: periodTo } });
      const view: MarketView = {
        ...emptyView,
        calendar: fourSessionCalendar,
        corporateActions: [centavosOverflowFactor],
        candles: [
          candle("PETR4", "2024-01-02", "10.00", "10.00"),
          candle("PETR4", "2024-01-03", "10.00", "10.00"),
          candle("PETR4", "2024-01-04", "10.00", "10.00", 0),
          candle("PETR4", "2024-01-05", "10.00", "10.00", 0),
        ],
      };
      const result = runBacktest({ view, config });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_input");
    },
  );

  it("rescales a stale pre-split mark read from before the ex-date to the post-split scale (#273), no phantom gain", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        // PETR4 does not trade on the ex-date session itself (illiquid): the period-end mark
        // and close both read the last known 2024-01-03 close, 10.00, pre-split — a price
        // the already-rebased (post-split) effective share count no longer shares.
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const dayOfSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-04");
    const dayBeforeSplit = result.value.run.equityCurve.find((p) => p.session === "2024-01-03");
    expect(dayOfSplit?.equity).toBe(dayBeforeSplit?.equity);
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    // No price move once rescaled (the same reasoning as the "no phantom drawdown" test
    // above): pnl is exactly the entry's own costs (250 b3Fee + 100 brokerage on a 5,000.00
    // gross), never a doubled mark from reading the stale price at the post-split quantity.
    expect(op.pnl).toBe(centavos(-350));
    expect(result.value.run.notes).toContainEqual(
      expect.objectContaining({ code: "stale_price_across_corporate_action" }),
    );
  });

  it("rescales an odd-centavo stale close exactly, never rounding the mark before the quantity multiplies it (#273)", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split],
      candles: [
        // Sizing reads this session's own close (the signal session, Q38): floor(10 000.00 ×
        // 0.5 / 10.00) = 500 shares, filled the next session at that session's own open, 10.05.
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        // No candle on the ex-date session (2024-01-04): the period-end mark reads this same
        // stale 10.05 close.
        candle("PETR4", "2024-01-03", "10.05", "10.05"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]).toMatchObject({
      quantity: quantity(500),
      price: decimalString("10.05"),
    });
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    // Rescaled mark: 10.05 × 0.5 = 5.025 exactly. effectiveEntryPrice: 10.05 (the fill's own
    // entry price) × 0.5 = 5.025 exactly too — the same price, the same factor, so the price
    // diff is exactly zero and pnl is exactly the entry's own costs (500 × 10.05 = 5 025.00
    // gross; b3Fee 251.25 → 251 centavos + 100 brokerage = 351). Rounding the rescaled mark to
    // PRICE_SCALE first (10.05 × 0.5 → "5.03", ROUND_HALF_UP) would manufacture a 0.005/share
    // phantom gain over 1 000 effective shares — 500 centavos — landing pnl at +149 instead of
    // -351.
    expect(op.pnl).toBe(centavos(-351));
  });

  it("rescales a mark exactly under a non-terminating split factor, no rounding drift against the identically-rebased entry (#273)", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-04" } });
    const repeatingFactor: CorporateActionFactor = { ...split, factor: decimalString("0.333333") };
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [repeatingFactor],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "10.00", "10.00"),
        // No candle on the ex-date session: the period-end mark reads the stale 10.00 close,
        // the same value and the same session the entry's own rebase starts from.
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    // The rescaled mark (10.00 × 0.333333) and legPnlCentavos's own effectiveEntryPrice
    // (10.00 × 0.333333) are the identical product of the identical stale session's price and
    // the identical factor: exactly equal, however many decimal places the multiplication
    // carries, so the price diff is exactly zero and pnl is exactly the entry's own costs
    // (500 × 10.00 = 5 000.00 gross; 250 b3Fee + 100 brokerage = 350).
    expect(op.pnl).toBe(centavos(-350));
  });
});

describe("runBacktest — corporate actions on entry fills", () => {
  it("rescales a pending entry's quantity by the split factor between its signal and fill sessions", () => {
    const split: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        // The entry signal at 2024-01-02's close sizes 500 shares against the pre-split
        // 10.00 price; the ex-date 2:1 split lands on the fill session itself, so the fill
        // must trade 1000 shares (500 / 0.5) at the post-split 5.00 open, not the pre-split
        // count at the post-split price.
        candle("PETR4", "2024-01-03", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]).toMatchObject({
      side: "buy",
      quantity: quantity(1000),
      price: decimalString("5.00"),
      session: "2024-01-03",
    });
  });

  it.each([
    ["session open", "2024-01-03T13:00:00.000Z"],
    ["intraday", "2024-01-03T16:00:00.000Z"],
    ["session close", "2024-01-03T20:00:00.000Z"],
  ])(
    "rescales a pending entry's quantity the same way regardless of the factor's asOf within the fill session (%s)",
    (_label, asOf) => {
      const split: CorporateActionFactor = {
        ticker: "PETR4",
        exDate: "2024-01-03",
        asOf,
        factor: decimalString("0.5"),
      };
      const calendar = ["2024-01-02", "2024-01-03"].map(session);
      const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
      const view: MarketView = {
        ...emptyView,
        calendar,
        corporateActions: [split],
        candles: [
          candle("PETR4", "2024-01-02", "10.00", "10.00"),
          candle("PETR4", "2024-01-03", "5.00", "5.00"),
        ],
      };
      const result = runBacktest({ view, config });
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.status !== "complete")
        throw new Error("expected a complete run");
      expect(result.value.run.fills[0]).toMatchObject({
        side: "buy",
        quantity: quantity(1000),
        price: decimalString("5.00"),
      });
      expect(result.value.run.limitBreaches).toEqual([]);
    },
  );

  it("leaves a pending entry's quantity unchanged when the factor's asOf is only visible the next day", () => {
    const split: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [split],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "5.00", "5.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]).toMatchObject({ quantity: quantity(500) });
  });

  it("leaves a pending entry's quantity unchanged when no split falls between signal and fill", () => {
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
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete")
      throw new Error("expected a complete run");
    expect(result.value.run.fills[0]).toMatchObject({ quantity: quantity(500) });
  });

  it("returns invalid_input, never a throw, when a grouping factor rounds a pending entry's quantity to zero", () => {
    const grouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("10000"),
    };
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [grouping],
      candles: [
        candle("PETR4", "2024-01-02", "10.00", "10.00"),
        candle("PETR4", "2024-01-03", "50000.00", "50000.00"),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input, never a throw, when a factor blows a pending entry's quantity past a safe integer", () => {
    const microFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("0.000000000000001"),
    };
    const calendar = ["2024-01-02", "2024-01-03"].map(session);
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [microFactor],
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
});

describe("runBacktest — centavos bound on a rescaled entry (#285)", () => {
  it("returns invalid_input, never a throw, when a factor leaves a pending entry's quantity safe but overflows its centavos", () => {
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-03",
      asOf: "2024-01-03T13:00:00.000Z",
      factor: decimalString("0.000000000001"),
    };
    const config = baseConfig({ period: { from: "2024-01-02", to: "2024-01-03" } });
    const view: MarketView = {
      ...emptyView,
      calendar: ["2024-01-02", "2024-01-03"].map(session),
      corporateActions: [factor],
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

  it("resuming twice from the same checkpoint object yields the same run both times (I4)", () => {
    const first = runBacktest({ view: chunkingView, config: chunkingConfig, maxSessions: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== "paused") throw new Error("expected a paused run");
    const checkpoint = first.value.checkpoint;

    const resumedOnce = runBacktest({
      view: chunkingView,
      config: chunkingConfig,
      resume: checkpoint,
    });
    const resumedTwice = runBacktest({
      view: chunkingView,
      config: chunkingConfig,
      resume: checkpoint,
    });
    expect(resumedOnce.ok).toBe(true);
    expect(resumedTwice.ok).toBe(true);
    if (!resumedOnce.ok || !resumedTwice.ok) throw new Error("expected both resumes to succeed");
    expect(resumedTwice).toEqual(resumedOnce);
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

describe("runBacktest — observed-session metrics filtering (#92, ADR-0041)", () => {
  const zeroCostModel = {
    b3FeeRate: decimalString("0"),
    brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
    optionSlippageRate: decimalString("0"),
    incomeTaxRate: decimalString("0"),
    monthlyStockSalesExemption: centavos(0),
  };

  it("excludes a mid-period candle-less gap from metrics.sessions, cagr and exposure", () => {
    const dates = businessDays(150);
    const gapStart = 65;
    const gapLen = 20;
    const isGap = (i: number): boolean => i >= gapStart && i < gapStart + gapLen;
    const calendar = dates.map(session);
    let rank = 0;
    const candles: Candle[] = [];
    dates.forEach((date, i) => {
      if (isGap(i)) return;
      const price = (10 + rank * 0.01).toFixed(2);
      candles.push(candle("PETR4", date, price, price));
      rank += 1;
    });
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          exit: [],
          sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
        }),
      ),
      universe: ["PETR4"],
      period: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
      initialCapital: centavos(100_000_00),
      costModel: zeroCostModel,
    });
    const view: MarketView = { ...emptyView, calendar, candles };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const observedCount = dates.length - gapLen;
    expect(run.metrics.sessions).toBe(observedCount);
    expect(run.notes).toContainEqual({
      code: "candle_less_sessions_excluded",
      message: `${String(gapLen)} session(s) excluded from sessions, sharpe and exposure: no universe ticker had a candle that session (still counted in cagr's elapsed clock and in maxDrawdown/totalReturn, ADR-0041)`,
    });
    expect(run.notes.some((n) => n.code === "warm_up_sessions_excluded")).toBe(false);

    // Reproduces the pre-#92 behaviour (every period session counted, including the gap) from
    // the run's own public equityCurve, to show the fix actually moves the numbers rather than
    // merely relabeling them: held is reconstructed from the strategy's own known shape here (a
    // single stock leg opened at the first fill, held through every following session, and
    // closed by the period-end sweep just before that final session's own equity point is
    // recorded — so held is false at index 0, before the fill, and at the very last index).
    const fullHeld = dates.map((_date, i) => i >= 1 && i < dates.length - 1);
    const { metrics: naive } = computeBacktestMetrics({
      equityCurve: run.equityCurve,
      initialCapital: config.initialCapital,
      rfPerSession: dates.map(() => decimalString("0")),
      held: fullHeld,
      observed: dates.map(() => true),
      postWarmup: dates.map(() => true),
      settledOperationPnls: [],
      operationsCount: run.operations.length,
      fees: run.metrics.fees,
      taxes: run.metrics.taxes,
      slippage: run.metrics.slippage,
    });
    expect(naive.sessions).toBe(dates.length);
    expect(naive.exposure).toBe(decimalString("0.986667"));
    expect(naive.cagr).toBe(decimalString("0.224276"));

    expect(run.metrics.exposure).toBe(decimalString("0.984615"));
    // cagr's exponent counts elapsed post-warm-up sessions, gaps included (ADR-0041): this run
    // has no warm-up prefix, so its post-warm-up span is the full 150 sessions — the same
    // exponent the naive comparison above used, hence the same value.
    expect(run.metrics.cagr).toBe(decimalString("0.224276"));
  });

  it("excludes the strategy's warm-up prefix from metrics.sessions and records the first tradable session", () => {
    const dates = businessDays(150);
    const calendar = dates.map(session);
    const candles = dates.map((date) => candle("PETR4", date, "10.00", "10.00"));
    const smaEntry: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    };
    const config = baseConfig({
      strategy: strategyVersion(definition({ entry: smaEntry, exit: [] })),
      universe: ["PETR4"],
      period: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
    });
    const view: MarketView = { ...emptyView, calendar, candles };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const warmupCount = 19;
    expect(run.metrics.sessions).toBe(dates.length - warmupCount);
    expect(run.metrics.exposure).toBe(decimalString("0.000000"));
    expect(run.metrics.cagr).toBe(decimalString("0.000000"));
    expect(run.notes).toContainEqual({
      code: "warm_up_sessions_excluded",
      message: `${String(warmupCount)} leading session(s) excluded from metrics: the strategy lacked enough history to evaluate; first tradable session ${dates[warmupCount] ?? ""}`,
    });
    expect(run.notes.some((n) => n.code === "candle_less_sessions_excluded")).toBe(false);
  });

  it("reports every session as warm-up, with no first tradable session, when the strategy never gets enough history", () => {
    const dates = businessDays(10);
    const calendar = dates.map(session);
    const candles = dates.map((date) => candle("PETR4", date, "10.00", "10.00"));
    const smaEntry: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 200 } },
    };
    const config = baseConfig({
      strategy: strategyVersion(definition({ entry: smaEntry, exit: [] })),
      universe: ["PETR4"],
      period: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
    });
    const view: MarketView = { ...emptyView, calendar, candles };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    expect(run.metrics.sessions).toBe(0);
    expect(run.metrics.exposure).toBe(decimalString("0.000000"));
    expect(run.notes).toContainEqual({
      code: "warm_up_sessions_excluded",
      message: `all ${String(dates.length)} session(s) in the run fell inside the warm-up window; the strategy never had enough history to evaluate`,
    });
  });
});

describe("runBacktest — roll adjustments with no eligible series (#383)", () => {
  const optionCalendar = businessDays(20).map(session);
  const singleCall: Structure = {
    id: "single_call",
    name: "Long call",
    expiry: "shared",
    legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
  };
  const rollAdjustment = {
    kind: "roll" as const,
    when: { kind: "profit_target" as const, fractionOfPremium: decimalString("0.1") },
    expiry: { kind: "business_days" as const, min: 20, max: 40 },
    strikes: [{ kind: "moneyness" as const, percent: decimalString("0") }],
  };

  function optionConfig(adjustments: StrategyDefinition["adjustments"]) {
    const days = businessDays(20);
    const expiry = days[15] as string;
    return {
      config: baseConfig({
        strategy: strategyVersion(
          {
            ...definition({
              entry: closeAbove9,
              exit: [],
              adjustments,
            }),
            structureId: "single_call",
            strikes: [{ kind: "nearest", price: decimalString("11.00") }],
            expiry: { kind: "business_days", min: 1, max: 18 },
          },
          singleCall,
        ),
        period: { from: days[0] as string, to: days[6] as string },
      }),
      view: {
        ...emptyView,
        calendar: optionCalendar,
        candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
        optionSeries: [
          callOrPutSeries(
            "PETR4C11",
            "call",
            "11.00",
            expiry,
            `${days[0] as string}T20:00:00.000Z`,
          ),
        ],
        optionPrices: days
          .slice(0, 7)
          .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "3.00")),
      } satisfies MarketView,
    };
  }

  // This fixture's 20-session calendar cannot list an expiry 20-40 business days past the
  // roll session (there is no room left on the calendar): the roll's own `when` still fires
  // (profit_target, the premium triples), but resolveLegSelection finds nothing to roll into,
  // so the operation is held without rolling and the gap is surfaced as a note, never silent.
  it("carries a run-wide note, once, when a fired roll finds no eligible series", () => {
    const { config, view } = optionConfig([rollAdjustment]);

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const occurrences = run.notes.filter((n) => n.code === "roll_no_series_match");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toEqual({
      code: "roll_no_series_match",
      message:
        "a roll rule's when condition fired, but no series matched its expiry/strikes selection at that session; the operation was held without rolling",
    });
    // Never rolled: the one operation this run opens closes by its own profit_target exit
    // rule, not by a roll (`closeReason.kind !== "rolled"` for every closed operation).
    expect(
      run.operations.every((op) => op.status !== "closed" || op.closeReason.kind !== "rolled"),
    ).toBe(true);
  });

  it("carries no such note when the strategy declares no adjustments", () => {
    const { config, view } = optionConfig([]);

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    expect(run.notes.some((n) => n.code === "roll_no_series_match")).toBe(false);
  });
});

describe("runBacktest — roll adjustments executed (#383)", () => {
  const coveredCallStructure: Structure = {
    id: "covered_call_roll",
    name: "Covered call",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  // A hand-computed covered call rolled once (#383): stock flat at 10.00 throughout (its
  // own leg never trades on the roll, ADR-0080), a near call (strike 11.00, expiry day 15,
  // premium 1.00) sold at entry and rolled once a roll rule's days_before_expiry `when`
  // fires (5 business days out, day 10) into a far call at the same strike (expiry day 32,
  // premium 1.20), with a 1% option slippage rate on every option fill. Every cash figure
  // below is traced by hand in the ticket's own PR description/commit message.
  function coveredCallRollFixture() {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[32] as string;
    const calendar = days.map(session);

    const costModel = {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0.01"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    const riskProfile = {
      declaredCapital: centavos(1_000_000),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };

    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.09") },
          }),
          structureId: "covered_call_roll",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        coveredCallStructure,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      costModel,
      riskProfile,
      period: { from: days[0] as string, to: days[12] as string },
    });

    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
      ],
    };

    return { config, view, days, nearExpiry, farExpiry };
  }

  it("closes the held operation as rolled and reopens at the far expiry, with hand-computed cash flows, fees, slippage and final equity", () => {
    const { config, view } = coveredCallRollFixture();

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    expect(run.operations).toHaveLength(2);
    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    const reopened = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "period_end",
    );
    expect(rolled).toBeDefined();
    expect(reopened).toBeDefined();
    if (rolled?.status !== "closed" || rolled.closeReason.kind !== "rolled") {
      throw new Error("expected a rolled operation");
    }
    if (reopened?.status !== "closed") throw new Error("expected a period_end operation");

    expect(rolled.closeReason.toOperationId).toBe(reopened.id);
    expect(reopened.rolledFrom).toBe(rolled.id);
    // The near call (100 contracts) is closed at a realized loss: bought back at 1.01
    // (1.00 + 1% buy-side slippage) after being sold at 0.99 (1.00 - 1% sell-side
    // slippage), plus a 5-centavo B3 fee on both the entry and the close:
    // (1.01 - 0.99) * 100 (centavos/real) * 100 (contracts) = 200, + 5 + 5 = 210 of loss.
    // The stock leg never trades on the roll, so it contributes nothing here.
    expect(rolled.pnl).toBe(centavos(-210));
    // The new operation's own stop/target bases are its own entry-priced bases (ADR-0014
    // Q50): closed at period_end, unmoved from its own entry (1.19, sold at 1.20 minus 1%
    // sell-side slippage, rounded to PRICE_SCALE) against the same flat 1.20 mark, plus its
    // own 6-centavo entry fee: (1.20 - 1.19) * 100 * 100 = 100, + 6 = 106 of loss on the call
    // leg, plus the carried stock leg's own original entry cost (150: 50 B3 fee + 100
    // brokerage), carried into the successor's own entryCosts rather than dropped (#383) —
    // this mark never trades the stock, so it changes this pnl figure, not cash/equity:
    // 106 + 150 = 256 of loss.
    expect(reopened.pnl).toBe(centavos(-256));

    const newCallLeg = reopened.legs.find((leg) => leg.role === "call");
    expect(newCallLeg?.ticker).toBe("PETR4C11F");
    expect(newCallLeg?.entryPrice).toBe(decimalString("1.19"));
    const carriedStockLeg = reopened.legs.find((leg) => leg.role === "stock");
    expect(carriedStockLeg?.entryPrice).toBe(decimalString("10.00"));
    expect(carriedStockLeg?.quantity).toBe(quantity(100));

    // Fees: stock entry 150 (50 b3 + 100 brokerage), call entry 5, roll close 5, roll open 6.
    expect(run.metrics.fees).toBe(centavos(166));
    // Slippage: |0.99-1.00|*100*100=100 (entry), |1.01-1.00|*100*100=100 (close),
    // |1.19-1.20|*100*100=100 (open, after PRICE_SCALE rounding).
    expect(run.metrics.slippage).toBe(centavos(300));

    expect(run.taxes).toHaveLength(1);
    expect(run.taxes[0]).toMatchObject({
      stockSales: centavos(0),
      stockGain: centavos(0),
      optionGain: centavos(-210),
      netGain: centavos(-210),
      tax: centavos(0),
    });

    const lastEquityPoint = run.equityCurve.at(-1);
    expect(lastEquityPoint?.cash).toBe(centavos(911_534));
    expect(lastEquityPoint?.equity).toBe(centavos(999_534));

    expect(run.fills).toHaveLength(4);
    expect(run.notes.some((n) => n.code === "roll_no_series_match")).toBe(false);
  });

  // Issue #285's own pattern, applied to a roll's own close fill: a factor visible only as of
  // the roll's fill session (never any earlier one, so no prior mark or exit-rule evaluation
  // ever sees it) leaves a safe unit count but overflows the closing option leg's own gross
  // centavos.
  it("returns invalid_input, never throws, when a factor overflows the roll's own closing option leg (#285 pattern, #383)", () => {
    const { config, view, days } = coveredCallRollFixture();
    const overflowFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[11] as string,
      asOf: `${days[11] as string}T13:00:00.000Z`,
      factor: decimalString("0.000000000001"),
    };
    const result = runBacktest({
      view: { ...view, corporateActions: [overflowFactor] },
      config,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  // A factor this extreme is caught earlier still: the near leg's own listed strike,
  // rescaled by the same corporate action (ADR-0056), underflows to zero or negative before
  // the roll's own close/carry rebase is ever reached — same guard, same error code, a
  // session before resolvePendingRollFills's own leg-level checks would otherwise apply.
  it("returns invalid_input, never throws, when a factor this extreme leaves a leg's own listed strike non-positive", () => {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[32] as string;
    const calendar = days.map(session);
    const lopsidedCoveredCall: Structure = {
      id: "lopsided_covered_call",
      name: "Covered call (lopsided ratio)",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 100_000 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      ] as LegTemplate[],
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "lopsided_covered_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        lopsidedCoveredCall,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000_00),
      riskProfile: {
        declaredCapital: centavos(1_000_000_00),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
      period: { from: days[0] as string, to: days[12] as string },
    });
    const overflowFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[11] as string,
      asOf: `${days[11] as string}T13:00:00.000Z`,
      factor: decimalString("0.000000000001"),
    };
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [overflowFactor],
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
      ],
    };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  // #383: a factor whose own `exDate` falls on or before the roll's signal
  // session, but whose own `asOf` lands strictly after that same session's close, was invisible
  // to the old entry-factor rebase (computed over `(signalSession, fillSession]`, which does not
  // contain this `exDate`) and to the signal-time proposal's own rebase alike (computed as of the
  // signal instant, before this `asOf`) — silently carrying the new option leg in at its stale
  // nominal quantity while the closing leg and the carried stock leg, both rebased through the
  // one true interval `(openedAt, fillSession]` seen at the fill's own close, already saw it.
  // The successor's own option leg must close and open the same quantity (every roll does).
  it("closes and opens the same quantity on the rolled option leg, for a factor whose asOf lands strictly after the signal session's own close (#383)", () => {
    const { config, view, days } = coveredCallRollFixture();
    const signalSession = days[10] as string;
    const lateAsOfFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: signalSession,
      asOf: `${signalSession}T20:00:00.001Z`,
      factor: decimalString("0.5"),
    };
    const result = runBacktest({
      view: { ...view, corporateActions: [lateAsOfFactor] },
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const closeFill = run.fills.find((f) => f.ticker === "PETR4C11" && f.side === "buy");
    const openFill = run.fills.find((f) => f.ticker === "PETR4C11F");
    expect(closeFill).toBeDefined();
    expect(openFill).toBeDefined();
    // 100 nominal contracts, factor 0.5 (a split): effective 200 on both sides of the roll.
    expect(openFill?.quantity).toBe(closeFill?.quantity);
    expect(openFill?.quantity).toBe(quantity(200));

    const reopened = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "period_end",
    );
    const reopenedCallLeg = reopened?.legs.find((leg) => leg.role === "call");
    const reopenedStockLeg = reopened?.legs.find((leg) => leg.role === "stock");
    expect(reopenedCallLeg?.quantity).toBe(quantity(200));
    expect(reopenedStockLeg?.quantity).toBe(quantity(200));
  });

  // General invariant behind C1's own golden above: whatever a grouping or split factor's own
  // magnitude and timing (ex-dated on the signal session itself, visible anywhere from right
  // after that session's own close up through the fill session's own close), every roll's
  // closing option leg and its own opened successor leg land on the same effective quantity —
  // the one position moving strikes, never two different rebases free to disagree.
  it.each([
    { factor: "0.5", asOfOffsetMs: 1 },
    { factor: "0.5", asOfOffsetMs: 23 * 60 * 60 * 1000 },
    { factor: "3", asOfOffsetMs: 1 },
    { factor: "3", asOfOffsetMs: 23 * 60 * 60 * 1000 },
  ])(
    "closes and opens the same rolled option quantity for factor $factor, asOf $asOfOffsetMs ms after the signal session's close",
    ({ factor, asOfOffsetMs }) => {
      const { config, view, days } = coveredCallRollFixture();
      const signalSession = days[10] as string;
      const signalClose = new Date(`${signalSession}T20:00:00.000Z`);
      const asOf = new Date(signalClose.getTime() + asOfOffsetMs).toISOString();
      const corporateAction: CorporateActionFactor = {
        ticker: "PETR4",
        exDate: signalSession,
        asOf,
        factor: decimalString(factor),
      };
      const result = runBacktest({
        view: { ...view, corporateActions: [corporateAction] },
        config,
      });
      expect(result.ok).toBe(true);
      if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
      const { run } = result.value;
      const closeFill = run.fills.find((f) => f.ticker === "PETR4C11" && f.side === "buy");
      const openFill = run.fills.find((f) => f.ticker === "PETR4C11F");
      expect(closeFill).toBeDefined();
      expect(openFill).toBeDefined();
      expect(openFill?.quantity).toBe(closeFill?.quantity);
    },
  );

  // A factor ex-dated on the fill session alone (not visible yet at evaluateStrategy's own
  // signal-time check above, which a stock-free leg selection never reaches with no factor
  // yet visible at the signal session) rounds a bought leg's own closed/rescaled quantity down
  // to zero. Held without rolling instead of aborting the run (#383): the same `roll_no_series_match`
  // degrade an empty selection already gets.
  it("holds the operation without rolling, never aborting the run, when a fill-session-only factor rounds the roll's new entry quantity to zero (#383)", () => {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[32] as string;
    const calendar = days.map(session);
    const longCallStructure: Structure = {
      id: "long_call_roll_zero_round",
      name: "Long call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.01") },
          }),
          structureId: "long_call_roll_zero_round",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        longCallStructure,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      riskProfile: {
        declaredCapital: centavos(1_000_000),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
      period: { from: days[0] as string, to: days[12] as string },
    });
    const fillSession = days[11] as string;
    const roundToZeroFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: fillSession,
      asOf: `${fillSession}T13:00:00.000Z`,
      factor: decimalString("1000000"),
    };
    const view: MarketView = {
      ...emptyView,
      calendar,
      corporateActions: [roundToZeroFactor],
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
      ],
    };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(
      run.operations.some((op) => op.status === "closed" && op.closeReason.kind === "rolled"),
    ).toBe(false);
    expect(run.notes.some((n) => n.code === "roll_no_series_match")).toBe(true);
  });

  // #383: a corporate-action factor between the roll's own signal and its fill can round an
  // option leg down to zero while a stock leg beside it, with a much larger nominal quantity
  // (its own structure ratio outweighs the option leg's), stays well above zero -- the option
  // leg alone is the one that would have aborted the whole run, before the fill-time pre-check
  // above was widened from stock legs to every leg.
  it("holds the operation without rolling, never aborting the run, when a factor rounds only the thinner option leg to zero while the stock leg stays positive (#383)", () => {
    const thinCallDays = businessDays(40);
    const thinCallNearExpiry = thinCallDays[15] as string;
    const thinCallFarExpiry = thinCallDays[32] as string;
    const thinCallCalendar = thinCallDays.map(session);
    const thinCallCoveredCall: Structure = {
      id: "thin_call_covered_call",
      name: "Covered call (thin call ratio)",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 2 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      ] as LegTemplate[],
    };
    const thinCallConfig = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.09") },
          }),
          structureId: "thin_call_covered_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        thinCallCoveredCall,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      riskProfile: {
        declaredCapital: centavos(1_000_000),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
      period: { from: thinCallDays[0] as string, to: thinCallDays[12] as string },
    });
    const thinCallFillSession = thinCallDays[11] as string;
    // Grouping factor 60:1: the stock leg's own ratio (2) is twice the call leg's (1), so its
    // own larger nominal quantity still floors to a positive effective quantity, while the
    // call leg's own smaller nominal quantity floors to zero.
    const thinLegFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: thinCallFillSession,
      asOf: `${thinCallFillSession}T13:00:00.000Z`,
      factor: decimalString("60"),
    };
    const thinCallView: MarketView = {
      ...emptyView,
      calendar: thinCallCalendar,
      corporateActions: [thinLegFactor],
      candles: thinCallDays.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          thinCallNearExpiry,
          `${thinCallDays[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          thinCallFarExpiry,
          `${thinCallDays[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...thinCallDays.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...thinCallDays.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
      ],
    };

    const result = runBacktest({ view: thinCallView, config: thinCallConfig });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(
      run.operations.some((op) => op.status === "closed" && op.closeReason.kind === "rolled"),
    ).toBe(false);
    expect(run.notes.some((n) => n.code === "roll_no_series_match")).toBe(true);
  });

  it("never carries the adjustment_not_applied note (removed, #383): capabilities reports roll as implemented", () => {
    const { config, view } = coveredCallRollFixture();
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    expect(result.value.run.notes.map((n) => n.code)).not.toContain("adjustment_not_applied");
  });

  it("settlement wins when a roll's own when only fires on the operation's own expiry session, never a race at all (ADR-0013 settlement interplay)", () => {
    const { config, view, nearExpiry } = coveredCallRollFixture();
    // businessDays: 0 means the when only fires on the expiry session itself — but
    // queueNextSignals (the only place a roll's own when is ever evaluated) runs after
    // resolveExpiringOperations within that same session, so the operation is already gone
    // from openOperations by then: no roll signal is ever queued, let alone raced against
    // settlement. This is not the roll-beats-settlement race (see the businessDays: 1 test
    // below); settlement wins here simply because the when never gets a chance to fire.
    const noRollInTime: BacktestConfig = {
      ...config,
      strategy: strategyVersion(
        {
          ...config.strategy.definition,
          adjustments: [
            {
              kind: "roll",
              when: { kind: "days_before_expiry", businessDays: 0 },
              expiry: { kind: "business_days", min: 20, max: 25 },
              strikes: [{ kind: "nearest", price: decimalString("11.00") }],
            },
          ],
        },
        config.strategy.structure,
      ),
      period: { from: config.period.from, to: nearExpiry },
    };

    const result = runBacktest({ view, config: noRollInTime });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    expect(run.operations).toHaveLength(1);
    expect(run.operations[0]?.status).toBe("expired");
    expect(
      run.operations.some((op) => op.status === "closed" && op.closeReason.kind === "rolled"),
    ).toBe(false);
  });

  it("rolls instead of settling when a roll's own when fires one session before expiry, the genuine same-session race (ADR-0013 settlement interplay)", () => {
    const { config, view, nearExpiry, days } = coveredCallRollFixture();
    // businessDays: 1 fires the when at days[14] (one session before nearExpiry at
    // days[15]), queuing a roll whose own fill attempt lands on days[15] itself —
    // resolvePendingRollFills runs before resolveExpiringOperations within that same
    // session, so the roll wins: the operation is rolled, never settled.
    const rollBeatsSettlement: BacktestConfig = {
      ...config,
      strategy: strategyVersion(
        {
          ...config.strategy.definition,
          adjustments: [
            {
              kind: "roll",
              when: { kind: "days_before_expiry", businessDays: 1 },
              expiry: { kind: "business_days", min: 15, max: 20 },
              strikes: [{ kind: "nearest", price: decimalString("11.00") }],
            },
          ],
        },
        config.strategy.structure,
      ),
      period: { from: config.period.from, to: days[16] as string },
    };

    const result = runBacktest({ view, config: rollBeatsSettlement });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolled).toBeDefined();
    expect(rolled?.closedAt).toBe(nearExpiry);
    expect(run.operations.some((op) => op.status === "expired")).toBe(false);
  });

  // #383: a roll rule's own `expiry` window wide enough to admit the operation's own
  // already-held series (or an even earlier one) would otherwise roll an operation into itself,
  // or into the past, every session its `when` keeps firing — `resolveRollTarget` excludes any
  // candidate expiry at or before the held one, so the roll fires exactly once, into the one
  // series whose own expiry clears that bar.
  it("rolls exactly once, not into itself repeatedly, when the roll rule's own expiry window is wide enough to admit the held series (#383)", () => {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[25] as string;
    const calendar = days.map(session);
    const costModel = {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0.01"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    const riskProfile = {
      declaredCapital: centavos(1_000_000),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                // Wide enough that, without the fix, the operation's own held series (or the
                // candidate it has already rolled into) would itself re-qualify every session.
                expiry: { kind: "business_days", min: 1, max: 30 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.09") },
          }),
          structureId: "covered_call_roll",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        coveredCallStructure,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      costModel,
      riskProfile,
      period: { from: days[0] as string, to: days[26] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...days.slice(0, 26).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
      ],
    };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const rolledOps = run.operations.filter(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolledOps).toHaveLength(1);
    // Exactly the near entry, near close, far open option slippage entries (100 each) — a
    // fourth, fifth or sixth self-roll would each add 200 more (a close and a re-open).
    expect(run.metrics.slippage).toBe(centavos(300));
  });

  // #383: the fixture is identical to `coveredCallRollFixture` except for a 1-for-2 grouping
  // ex-dated between the operation's own entry and the roll's own fire session — the successor's
  // own option quantity must still equal the closed operation's own (rebased) quantity, keeping
  // the structure's 1:1 ratio to the carried stock leg, not the held operation's stale
  // pre-grouping count.
  it("rebases the successor's new option leg quantity by the factor since entry, keeping the structure's ratio to the carried stock (#383)", () => {
    const { config, view, days } = coveredCallRollFixture();
    // A factor of 2 is a 1-for-2 grouping (reverse split): the effective count is the nominal
    // count divided by the factor (ADR-0014 Q51), so 100 nominal units become 50 effective.
    const groupingFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[3] as string,
      asOf: `${days[3] as string}T13:00:00.000Z`,
      factor: decimalString("2"),
    };
    const result = runBacktest({
      view: { ...view, corporateActions: [groupingFactor] },
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    const reopened = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "period_end",
    );
    if (rolled === undefined || reopened === undefined) throw new Error("expected both operations");

    // The closed operation's own legs stay nominal at their original 100 (ADR-0014 Q51:
    // `Operation.legs` is never rebased in place, only at point of use) even though only the
    // grouped, effective 50 units actually traded on its own close fill. The successor's own
    // legs are nominal at its own fresh entry instead — 50, the held quantity rebased by the
    // factor since the original entry, not the stale pre-grouping 100.
    const closedCallLeg = rolled.legs.find((leg) => leg.role === "call");
    const newCallLeg = reopened.legs.find((leg) => leg.role === "call");
    const carriedStockLeg = reopened.legs.find((leg) => leg.role === "stock");
    expect(closedCallLeg?.quantity).toBe(quantity(100));
    expect(newCallLeg?.quantity).toBe(quantity(50));
    expect(carriedStockLeg?.quantity).toBe(quantity(50));
    // The structure's own 1:1 ratio between the stock and call legs survives the grouping.
    expect(newCallLeg?.quantity).toBe(carriedStockLeg?.quantity);
  });

  // #383: every operation's own pnl, summed, must equal the run's own equity change
  // (initialCapital to the final equity point) whenever no tax is due — the carried stock leg's
  // own entry cost carries into the successor's own `entryCosts` so this identity holds. Extends
  // the golden fixture one session further so the carried stock is actually sold (a profit_target
  // exit on the successor), realizing the stock leg's own gain and taxing it.
  it("sum(operations.pnl) equals the run's own equity change when no tax is due, and selling the carried stock later realizes its own stockGain (#383)", () => {
    const { config, view, days } = coveredCallRollFixture();

    const noTaxResult = runBacktest({ view, config });
    expect(noTaxResult.ok).toBe(true);
    if (!noTaxResult.ok || noTaxResult.value.status !== "complete") {
      throw new Error("expected complete");
    }
    const { run: noTaxRun } = noTaxResult.value;
    expect(noTaxRun.taxes.every((t) => t.tax === 0)).toBe(true);
    const totalPnl = noTaxRun.operations.reduce((sum, op) => sum + op.pnl, 0);
    const firstEquity = config.initialCapital;
    const lastEquity = noTaxRun.equityCurve.at(-1)?.equity ?? 0;
    expect(totalPnl).toBe(lastEquity - firstEquity);

    const withExitConfig: BacktestConfig = {
      ...config,
      strategy: strategyVersion(
        {
          ...config.strategy.definition,
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.01") }],
        },
        config.strategy.structure,
      ),
      period: { from: config.period.from, to: days[20] as string },
    };
    // A flat premium never satisfies a profit_target base (ADR-0014 Q50, the successor's own
    // entry-priced base): dropping the far leg's own premium after the roll, comfortably below
    // its ~1.19 base, is what actually fires the exit and sells the carried stock leg with it.
    const droppedDays = new Set(days.slice(17, 21));
    const extendedView: MarketView = {
      ...view,
      optionPrices: [
        ...view.optionPrices.filter(
          (p) => !(p.ticker === "PETR4C11F" && droppedDays.has(p.session)),
        ),
        ...days.slice(17, 21).map((d) => optionDayPrice("PETR4C11F", d, "1.00")),
      ],
    };
    const withExitResult = runBacktest({ view: extendedView, config: withExitConfig });
    expect(withExitResult.ok).toBe(true);
    if (!withExitResult.ok || withExitResult.value.status !== "complete") {
      throw new Error("expected complete");
    }
    const { run: withExitRun } = withExitResult.value;
    const stockSold = withExitRun.taxes.some((t) => t.stockGain !== 0);
    expect(stockSold).toBe(true);
  });

  // #383: a long call rolling into a far-dated series whose own premium alone breaches
  // `maxPremiumBought` under `limits: "enforce"` is refused outright — the held operation
  // stays open, unrolled, and the breach is recorded.
  it("refuses a roll whose successor breaches maxPremiumBought under limits: enforce, and records the breach (#383)", () => {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[32] as string;
    const calendar = days.map(session);
    const longCallStructure: Structure = {
      id: "long_call_roll",
      name: "Long call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
    };
    const costModel = {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0.01"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.01") },
          }),
          structureId: "long_call_roll",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        longCallStructure,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      costModel,
      riskProfile: {
        declaredCapital: centavos(1_000_000),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          // The near leg's own premium (0.01) clears this; the far leg's own, ten times
          // richer, does not.
          maxPremiumBought: decimalString("0.10"),
        },
      },
      limits: "enforce",
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        // Richer than the near leg by far more than maxPremiumBought (0.10) allows, relative
        // to a 1% sizing fraction of declared capital.
        ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "30.00")),
      ],
    };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    expect(
      run.operations.some((op) => op.status === "closed" && op.closeReason.kind === "rolled"),
    ).toBe(false);
    expect(run.notes.some((n) => n.code === "roll_refused_limit_breach")).toBe(true);
  });

  // #383: the "warn" branch of the same decision above, where a long call has no stock leg
  // to carry forward at all, and closing/opening a bought leg
  // (rather than every other fixture's sold call) exercises the roll's own "buy" side
  // direction on both its close and its open fill. Under `warn`, the same breach the enforce
  // test above refuses instead fills, with the breach recorded against the successor.
  it("fills a roll with no stock leg under limits: warn, recording the breach against the successor", () => {
    const days = businessDays(40);
    const nearExpiry = days[15] as string;
    const farExpiry = days[32] as string;
    const calendar = days.map(session);
    const longCallStructure: Structure = {
      id: "long_call_roll_warn",
      name: "Long call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
    };
    const costModel = {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0.01"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [],
            adjustments: [
              {
                kind: "roll",
                when: { kind: "days_before_expiry", businessDays: 5 },
                expiry: { kind: "business_days", min: 20, max: 25 },
                strikes: [{ kind: "nearest", price: decimalString("11.00") }],
              },
            ],
            sizing: { kind: "fixed_fractional", fraction: decimalString("0.01") },
          }),
          structureId: "long_call_roll_warn",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 16 },
        },
        longCallStructure,
      ),
      universe: ["PETR4"],
      initialCapital: centavos(1_000_000),
      costModel,
      riskProfile: {
        declaredCapital: centavos(1_000_000),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("0.10"),
        },
      },
      limits: "warn",
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries(
          "PETR4C11",
          "call",
          "11.00",
          nearExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
        callOrPutSeries(
          "PETR4C11F",
          "call",
          "11.00",
          farExpiry,
          `${days[0] as string}T20:00:00.000Z`,
        ),
      ],
      optionPrices: [
        ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
        ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "30.00")),
      ],
    };

    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolled).toBeDefined();
    expect(rolled?.legs.some((leg) => leg.role === "stock")).toBe(false);
    expect(run.limitBreaches.some((b) => b.limit === "maxPremiumBought")).toBe(true);
    expect(run.notes.some((n) => n.code === "roll_refused_limit_breach")).toBe(false);
  });

  // #383: maxOpenOperations is exempt from a roll's own limit check — a roll replaces one
  // operation with one, never changing the count — but `priceLegsAt` (shared with the entry
  // path) has no way to know that from the plain `openOperationCountNow` it is handed: that
  // count already includes the operation being rolled, so the shared pricing call's own
  // `+ 1` reads as a genuinely new operation on top of it. With exactly one operation open and
  // maxOpenOperations: 1, every roll would be wrongly refused under enforce (or wrongly warned
  // under warn) without the fix filtering this one limit out of the roll's own breaches.
  it("rolls under limits: enforce, with maxOpenOperations: 1 and one operation open, never refusing on a false maxOpenOperations breach", () => {
    const { config, view } = coveredCallRollFixture();
    const result = runBacktest({
      view,
      config: {
        ...config,
        limits: "enforce",
        riskProfile: {
          ...config.riskProfile,
          limits: { ...config.riskProfile.limits, maxOpenOperations: 1 },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolled).toBeDefined();
    expect(run.limitBreaches.some((b) => b.limit === "maxOpenOperations")).toBe(false);
    expect(run.notes.some((n) => n.code === "roll_refused_limit_breach")).toBe(false);
  });

  it("rolls under limits: warn, with maxOpenOperations: 1 and one operation open, never recording a false maxOpenOperations breach", () => {
    const { config, view } = coveredCallRollFixture();
    const result = runBacktest({
      view,
      config: {
        ...config,
        limits: "warn",
        riskProfile: {
          ...config.riskProfile,
          limits: { ...config.riskProfile.limits, maxOpenOperations: 1 },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolled).toBeDefined();
    expect(run.limitBreaches.some((b) => b.limit === "maxOpenOperations")).toBe(false);
  });

  // #383: a grouping factor that does not divide the carried
  // stock leg's own quantity evenly leaves a fractional residue, cash-settled rather than
  // rounded into a share the operation was never granted.
  it("cash-settles a residue left on the carried stock leg by a factor that does not divide its quantity evenly", () => {
    const { config, view, days } = coveredCallRollFixture();
    const oddFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[3] as string,
      asOf: `${days[3] as string}T13:00:00.000Z`,
      factor: decimalString("3"),
    };
    const result = runBacktest({
      view: { ...view, corporateActions: [oddFactor] },
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const reopened = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "period_end",
    );
    expect(reopened).toBeDefined();
    const carriedStockLeg = reopened?.legs.find((leg) => leg.role === "stock");
    // 100 nominal units grouped 1-for-3: floor(100/3) = 33 effective, the residue (0.33...)
    // cash-settled rather than carried as a fractional share.
    expect(carriedStockLeg?.quantity).toBe(quantity(33));
  });

  // #383: a grouping this aggressive is not a corrupt factor, only too
  // aggressive for this 100-share position to survive a roll with a whole share left — held
  // without rolling instead of aborting the whole run, the same `roll_no_series_match` degrade
  // an empty selection already gets.
  it("holds the operation without rolling, never aborting the run, when a grouping factor leaves the carried stock leg with no whole share (#383)", () => {
    const { config, view, days } = coveredCallRollFixture();
    // Ex-dated on the roll's own fill session, exactly as the sibling overflow tests above
    // are, so this factor rescales only this fill's own legs and never an earlier session's
    // mark (which would fail there instead, for an unrelated reason).
    const extremeFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[11] as string,
      asOf: `${days[11] as string}T13:00:00.000Z`,
      factor: decimalString("150"),
    };
    const result = runBacktest({
      view: { ...view, corporateActions: [extremeFactor] },
      config,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    expect(rolled).toBeUndefined();
    const stillOpen = run.operations.find((op) => op.status === "closed");
    expect(stillOpen).toBeDefined();
    expect(run.notes.some((n) => n.code === "roll_no_series_match")).toBe(true);
  });

  // #383: a roll's own close/open fill retries, same as a
  // pending exit or entry, when a leg's own option price is not yet available at the session
  // its `when` fired — here the far leg's own first listed price lags the fire session by one
  // day — and fills the next session once it is.
  it("retries the roll's own fill when a leg's price is not yet available at the first fill attempt", () => {
    const { config, view, days } = coveredCallRollFixture();
    // The `when` fires at the end of days[10] (5 business days before nearExpiry at
    // days[15]), queuing the roll for its first fill attempt at days[11]'s open; removing
    // the far leg's price for that one session, and that session alone, forces
    // `resolvePendingRollFills` to skip it and retry at the next session instead.
    const firstAttemptSession = days[11] as string;
    const delayedView: MarketView = {
      ...view,
      optionPrices: view.optionPrices.filter(
        (p) => !(p.ticker === "PETR4C11F" && p.session === firstAttemptSession),
      ),
    };
    const extendedConfig = {
      ...config,
      period: { from: config.period.from, to: days[13] as string },
    };
    const result = runBacktest({ view: delayedView, config: extendedConfig });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;

    const rolled = run.operations.find(
      (op) => op.status === "closed" && op.closeReason.kind === "rolled",
    );
    if (rolled === undefined) throw new Error("expected a rolled operation");
    expect(rolled.closedAt).toBe(days[12]);
  });

  // #383: `isValidPendingRoll`/`isValidLeg` guard a resumed
  // checkpoint's own `state.pendingRolls`, a field that is only ever non-empty between the
  // session a roll's `when` fires (queueNextSignals queues it) and the very next session
  // (resolvePendingRollFills fills it) — this pauses exactly inside that one-session window.
  it("resumes correctly across a checkpoint paused between a roll's own queuing and its fill", () => {
    const { config, view, days } = coveredCallRollFixture();
    const fireSession = days[10] as string;

    const whole = runBacktest({ view, config });
    expect(whole.ok).toBe(true);
    if (!whole.ok || whole.value.status !== "complete") throw new Error("expected complete");

    const paused = runBacktest({ view, config, maxSessions: 11 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected paused");
    const pausedState = paused.value.checkpoint.state as { pendingRolls: Record<string, unknown> };
    expect(Object.keys(pausedState.pendingRolls)).toHaveLength(1);
    expect(paused.value.checkpoint.cursor).toBe(fireSession);

    const resumed = runBacktest({ view, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.value.status !== "complete") throw new Error("expected complete");

    expect(resumed.value.run).toEqual(whole.value.run);
  });

  // Coverage: `entryCosts`/per-leg `entryCost` fall back to zero (never throw) when a
  // resumed checkpoint's own `entryCosts` map is missing the rolled operation's own entry —
  // `isValidCheckpointState` only checks the map's own shape, never that every open
  // operation has its own entry in it, the same leniency every other op-closing path in this
  // file already extends to a hand-edited checkpoint.
  it("falls back to a zero entry cost, never throws, when a resumed checkpoint's entryCosts omits the rolling operation", () => {
    const { config, view } = coveredCallRollFixture();
    const paused = runBacktest({ view, config, maxSessions: 11 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected paused");
    const state = paused.value.checkpoint.state as {
      pendingRolls: Record<string, unknown>;
      entryCosts: Record<string, unknown>;
    };
    const [rollingOpId] = Object.keys(state.pendingRolls);
    const entryCostsWithoutRollingOp = Object.fromEntries(
      Object.entries(state.entryCosts).filter(([opId]) => opId !== rollingOpId),
    );
    const corruptedCheckpoint = {
      ...paused.value.checkpoint,
      state: { ...state, entryCosts: entryCostsWithoutRollingOp },
    };
    const resumed = runBacktest({ view, config, resume: corruptedCheckpoint });
    expect(resumed.ok).toBe(true);
  });

  // Same leniency, one level deeper: the rolling operation's own entryCosts entry survives
  // the resume, but a hand-edited checkpoint shortens it to fewer elements than the
  // operation's own legs — each leg still falls back to a zero entry cost on its own, rather
  // than reading past the array's own end.
  it("falls back to a zero entry cost per leg, never throws, when a resumed checkpoint's entryCosts entry is shorter than the rolling operation's own legs", () => {
    const { config, view } = coveredCallRollFixture();
    const paused = runBacktest({ view, config, maxSessions: 11 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected paused");
    const state = paused.value.checkpoint.state as {
      pendingRolls: Record<string, unknown>;
      entryCosts: Record<string, unknown[]>;
    };
    const [rollingOpId] = Object.keys(state.pendingRolls);
    const shortenedEntryCosts = { ...state.entryCosts, [rollingOpId as string]: [] };
    const corruptedCheckpoint = {
      ...paused.value.checkpoint,
      state: { ...state, entryCosts: shortenedEntryCosts },
    };
    const resumed = runBacktest({ view, config, resume: corruptedCheckpoint });
    expect(resumed.ok).toBe(true);
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

  it("returns invalid_input instead of throwing when a resumed chunk's view carries a non-positive corporate-action factor", () => {
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
    // A resumed chunk fills and marks its own open operations (carried over from the
    // checkpoint) before `evaluateStrategy` ever validates this same session's view: a
    // non-positive factor must be caught by `runBacktest`'s own upfront validation, not reach
    // `splitFactorProduct`'s invariant through a still-unvalidated view.
    const zeroFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-04",
      asOf: "2024-01-04T13:00:00.000Z",
      factor: decimalString("0"),
    };
    const invalidView: MarketView = { ...fullView, corporateActions: [zeroFactor] };
    const resumed = runBacktest({
      view: invalidView,
      config,
      resume: paused.value.checkpoint,
    });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("invalid_input");
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
        held: [],
        rfPerSession: [],
        hasCandle: [],
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

  it.each([
    ["null", () => null],
    ["a non-object", () => "not-a-state"],
    ["an object missing equityCurve", () => ({})],
    ["an object whose equityCurve is not an array", () => ({ equityCurve: "nope" })],
    [
      "an object with a valid equityCurve but a non-array openOperations",
      (valid: object) => ({ ...valid, openOperations: "nope" }),
    ],
    [
      "an object whose pendingEntries is not a plain object",
      (valid: object) => ({ ...valid, pendingEntries: "nope" }),
    ],
    ["an object whose cash is not a number", (valid: object) => ({ ...valid, cash: "nope" })],
    [
      "an object whose currentMonthKey is neither a string nor null",
      (valid: object) => ({ ...valid, currentMonthKey: 123 }),
    ],
    [
      "an object whose equityClampEngaged is not a boolean",
      (valid: object) => ({ ...valid, equityClampEngaged: "nope" }),
    ],
    [
      "an object whose pendingTaxDeduction is neither null nor a plain object",
      (valid: object) => ({ ...valid, pendingTaxDeduction: "nope" }),
    ],
    [
      "an object whose optionStrikeDerivedAcrossCorporateActionNoted is not a boolean",
      (valid: object) => ({ ...valid, optionStrikeDerivedAcrossCorporateActionNoted: "nope" }),
    ],
    [
      "an object whose firstTradableSession is neither a string nor null (ADR-0041)",
      (valid: object) => ({ ...valid, firstTradableSession: 123 }),
    ],
    [
      "an object whose hasCandle is not an array (ADR-0041)",
      (valid: object) => ({ ...valid, hasCandle: "nope" }),
    ],
    [
      "a pendingTaxDeduction whose tax is not finite",
      (valid: object) => ({ ...valid, pendingTaxDeduction: { tax: "nope" } }),
    ],
    ["cash is NaN", (valid: object) => ({ ...valid, cash: NaN })],
    ["cash is Infinity", (valid: object) => ({ ...valid, cash: Infinity })],
    [
      "an equityCurve element is not an object",
      (valid: object) => ({ ...valid, equityCurve: [null] }),
    ],
    [
      "a pendingEntries ticker's value has no legs array",
      (valid: object) => ({ ...valid, pendingEntries: { PETR4: {} } }),
    ],
    [
      "a pendingExits id's value has neither operationId nor rule",
      (valid: object) => ({ ...valid, pendingExits: { "op-1": {} } }),
    ],
    [
      "a taxesFinalized element has a non-finite tax",
      (valid: object) => ({ ...valid, taxesFinalized: [{}] }),
    ],
    [
      "a pendingSettlements entry has a non-finite residualQuantity",
      (valid: object) => ({
        ...valid,
        pendingSettlements: {
          "op-1": {
            op: {},
            settlement: [],
            pnlSoFar: 0,
            residualQuantity: "nope",
            residualAvgCostCentavos: "0",
            expirySession: "2024-01-02",
          },
        },
      }),
    ],
    // A pendingSettlements entry only ever exists for a residual still
    // awaiting its own close; one with residualQuantity: 0 is corrupt input (never a shape
    // this engine's own writers produce — see the type's own comment), and must be rejected
    // here, before toQuantity(Math.abs(0)) can throw on the next session's own residual-fill
    // step.
    [
      "a pendingSettlements entry has residualQuantity: 0",
      (valid: object) => ({
        ...valid,
        pendingSettlements: {
          "op-1": {
            op: {},
            settlement: [],
            pnlSoFar: 0,
            optionGainSoFarCentavos: 0,
            residualQuantity: 0,
            residualAvgCostCentavos: "0",
            expirySession: "2024-01-02",
          },
        },
      }),
    ],
    // residualAvgCostCentavos is a DecimalString (full precision), never a
    // rounded number.
    [
      "a pendingSettlements entry has a non-string residualAvgCostCentavos",
      (valid: object) => ({
        ...valid,
        pendingSettlements: {
          "op-1": {
            op: {},
            settlement: [],
            pnlSoFar: 0,
            optionGainSoFarCentavos: 0,
            residualQuantity: 100,
            residualAvgCostCentavos: 1000.5,
            expirySession: "2024-01-02",
          },
        },
      }),
    ],
    [
      "a slippageEntries element has a non-finite amount",
      (valid: object) => ({
        ...valid,
        slippageEntries: [{ session: "2024-01-02", amount: "nope" }],
      }),
    ],
    // residualAvgCostCentavos passes typeof === "string" but is not a decimal
    // string a caller hand-edited or truncated a checkpoint field into — new Decimal("nope")
    // must never reach the resumed run as a thrown DecimalError.
    [
      "a pendingSettlements entry has a non-decimal residualAvgCostCentavos string",
      (valid: object) => ({
        ...valid,
        pendingSettlements: {
          "op-1": {
            op: {},
            settlement: [],
            pnlSoFar: 0,
            optionGainSoFarCentavos: 0,
            residualQuantity: 100,
            residualAvgCostCentavos: "nope",
            expirySession: "2024-01-02",
          },
        },
      }),
    ],
    // An openOperations leg's entryPrice is the same class of caller-owned
    // DecimalString field; a corrupt one must never reach parseDecimal deep in the resumed run.
    [
      "an openOperations leg has a non-decimal entryPrice string",
      (valid: object) => ({
        ...valid,
        openOperations: [
          {
            id: "op-1",
            legs: [
              { role: "stock", side: "buy", ticker: "PETR4", quantity: 100, entryPrice: "nope" },
            ],
          },
        ],
      }),
    ],
    // held, rfPerSession and hasCandle are parallel to equityCurve by construction (ADR-0041); a
    // shorter or longer one than equityCurve must fail here, not throw from assertDefined or
    // silently zero-pad the resumed run's own metrics.
    [
      "held is shorter than equityCurve",
      (valid: object) => ({ ...valid, held: (valid as { held: unknown[] }).held.slice(0, -1) }),
    ],
    [
      "rfPerSession is longer than equityCurve",
      (valid: object) => ({
        ...valid,
        rfPerSession: [...(valid as { rfPerSession: unknown[] }).rfPerSession, "0"],
      }),
    ],
    [
      "hasCandle is shorter than equityCurve",
      (valid: object) => ({
        ...valid,
        hasCandle: (valid as { hasCandle: unknown[] }).hasCandle.slice(0, -1),
      }),
    ],
    ["pendingRolls is not a plain object", (valid: object) => ({ ...valid, pendingRolls: "nope" })],
    [
      "a pendingRolls entry's newLegs has a leg with a non-integer quantity",
      (valid: object) => ({
        ...valid,
        pendingRolls: {
          "op-1": {
            newLegs: [{ role: "call", side: "sell", ticker: "PETR4C11F", quantity: "nope" }],
            maxLoss: 0,
            limitBreaches: [],
            signalSession: "2024-01-02",
          },
        },
      }),
    ],
    [
      "a pendingRolls entry's limitBreaches is not an array",
      (valid: object) => ({
        ...valid,
        pendingRolls: {
          "op-1": {
            newLegs: [],
            maxLoss: 0,
            limitBreaches: "nope",
            signalSession: "2024-01-02",
          },
        },
      }),
    ],
  ])(
    "returns checkpoint_mismatch, never a throw, when the resumed state is %s",
    (_label, corrupt: (valid: object) => unknown) => {
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
      const malformedState = corrupt(paused.value.checkpoint.state as object);
      const corruptedCheckpoint = { ...paused.value.checkpoint, state: malformedState };
      const result = runBacktest({ view, config, resume: corruptedCheckpoint });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("checkpoint_mismatch");
    },
  );

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
        engineVersion: ENGINE_VERSION,
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
        brokerage: { stockPerOrder: centavos(5_000_000), optionPerOrder: centavos(0) },
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

  it("counts a short entry's sell fill toward the month's stockSales, crossing the exemption and owing tax", () => {
    const calendar = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"].map(session);
    // Capital large enough that the entry's own sell (250,000 shares at 10.00 = R$2,500,000)
    // alone crosses the R$2,000,000 monthly stock-sales exemption on the entry fill, not the
    // exit.
    const largeRiskProfile = {
      declaredCapital: centavos(5_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };
    const config = baseConfig({
      strategy: strategyVersion(
        definition({
          entry: closeAbove9,
          structureId: "short-stock",
          exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.05") }],
        }),
        shortStructure,
      ),
      initialCapital: centavos(5_000_000_00),
      riskProfile: largeRiskProfile,
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
    expect(tax?.stockSales).toBeGreaterThan(centavos(2_000_000_00));
    const op = result.value.run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") throw new Error("expected a closed operation");
    expect(op.pnl).toBeGreaterThan(0);
    expect(tax?.tax).toBeGreaterThan(centavos(0));
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

describe("runBacktest — option structures (#23)", () => {
  const optionCalendar = businessDays(20).map(session);

  const singleCall: Structure = {
    id: "single_call",
    name: "Long call",
    expiry: "shared",
    legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
  };

  it("fills an option entry at the next session's average and an exit at the next session's average on a profit target", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.2") }],
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days
        .slice(0, 7)
        .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "3.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.fills[0]).toMatchObject({
      ticker: "PETR4C11",
      side: "buy",
      source: "next_session_average",
      price: decimalString("1.00"),
    });
    const op = run.operations[0];
    expect(op?.status).toBe("closed");
    if (op?.status !== "closed") return;
    expect(op.closeReason.kind).toBe("exit_rule");
    expect(op.pnl).toBeGreaterThan(0);
    const exitFill = run.fills.find((f) => f.operationId === op.id && f.side === "sell");
    expect(exitFill).toMatchObject({
      ticker: "PETR4C11",
      side: "sell",
      source: "next_session_average",
    });
  });

  it("slips every option fill by optionSlippageRate and reports a non-zero metrics.slippage, split across walk-forward windows", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.2") }],
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
      walkForward: { windowSessions: 4 },
      costModel: {
        b3FeeRate: decimalString("0.0005"),
        brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(50) },
        optionSlippageRate: decimalString("0.05"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days
        .slice(0, 7)
        .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "3.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    // Entry (2024-01-03): reference average 1.00, buy side, filled = 1.00 × 1.05 = 1.05;
    // slippage = |1.05 − 1.00| × 100 × 5000 = 25 000. Exit (2024-01-05, profit_target):
    // reference average 3.00, sell side, filled = 3.00 × 0.95 = 2.85; slippage = |2.85 −
    // 3.00| × 100 × 5000 = 75 000. Re-entry (2024-01-08): reference 3.00, buy side, filled
    // = 3.00 × 1.05 = 3.15; slippage = |3.15 − 3.00| × 100 × 3164 = 47 460. Run total =
    // 25 000 + 75 000 + 47 460 = 147 460.
    expect(run.fills.map((f) => f.price)).toEqual([
      decimalString("1.05"),
      decimalString("2.85"),
      decimalString("3.15"),
    ]);
    expect(run.metrics.slippage).toBe(centavos(147460));
    // Window 1 (2024-01-02..2024-01-05) carries the entry and the exit fill: 25 000 +
    // 75 000 = 100 000. Window 2 (2024-01-08..2024-01-10) carries only the re-entry:
    // 47 460. Each window's own slippage excludes the other's fills — the same filter
    // (backtest-metrics.ts's computeWalkForwardWindows) that sums the whole run's slippage
    // above, restricted to `[from, to]`.
    expect(run.walkForward).toHaveLength(2);
    expect(run.walkForward?.[0]?.metrics.slippage).toBe(centavos(100000));
    expect(run.walkForward?.[1]?.metrics.slippage).toBe(centavos(47460));
  });

  it("notes option_strike_unadjusted_across_corporate_action when a split falls inside an option-legged operation's life with no epoch of its own reflecting it yet", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: days[5] as string,
          asOf: `${days[5] as string}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    expect(result.value.run.notes).toContainEqual(
      expect.objectContaining({ code: "option_strike_unadjusted_across_corporate_action" }),
    );
  });

  it("notes option_strike_derived_across_corporate_action when a factor is ex-dated exactly on an option-legged operation's own expiry session", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: expiry,
          asOf: `${expiry}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    expect(result.value.run.notes).toContainEqual(
      expect.objectContaining({ code: "option_strike_derived_across_corporate_action" }),
    );
  });

  it("rolls an exit-rule base's own option_strike_derived_across_corporate_action note up into the run's notes when an operation exits by profit_target before expiry (#269)", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.2") }],
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: days[2] as string,
          asOf: `${days[2] as string}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days
        .slice(0, 7)
        .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "3.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.operations[0]?.status).toBe("closed");
    if (run.operations[0]?.status !== "closed") throw new Error("expected a closed operation");
    expect(run.operations[0].closeReason.kind).toBe("exit_rule");
    expect(run.notes).toContainEqual(
      expect.objectContaining({ code: "option_strike_derived_across_corporate_action" }),
    );
  });

  it("rolls an exit-rule base's own option_strike_unadjusted_across_corporate_action note up into the run's notes when an operation exits by profit_target before expiry (#269)", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.2") }],
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: days[1] as string,
          asOf: `${days[1] as string}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days
        .slice(0, 7)
        .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "3.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.operations[0]?.status).toBe("closed");
    if (run.operations[0]?.status !== "closed") throw new Error("expected a closed operation");
    expect(run.operations[0].closeReason.kind).toBe("exit_rule");
    expect(run.notes).toContainEqual(
      expect.objectContaining({ code: "option_strike_unadjusted_across_corporate_action" }),
    );
  });

  it("rolls an accepted entry proposal's own option_strike_derived_across_corporate_action note up into the run's notes even once a later epoch makes every subsequent exit-rule base read none (#269)", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 2 ? "8.00" : "10.00", i < 2 ? "8.00" : "10.00"),
      ),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: days[2] as string,
          asOf: `${days[2] as string}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C11", "call", "5.50", expiry, `${days[2] as string}T20:00:00.001Z`),
      ],
      optionPrices: days.slice(0, 7).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.operations).toHaveLength(1);
    expect(run.notes).toContainEqual(
      expect.objectContaining({ code: "option_strike_derived_across_corporate_action" }),
    );
  });

  it("rescales an illiquid option leg's stale pre-split mark by the factor since its own session (#273), no phantom jump in equity", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: days[3] as string,
          asOf: `${days[3] as string}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      // The series never trades again after the entry fill on days[1] (days[0]'s own row only
      // feeds the entry's own sizing preview, evaluated at the signal instant): every later
      // mark — days[2] through the period_end close on days[6] — reads this same stale row,
      // and the split's ex-date (days[3]) falls strictly after it.
      optionPrices: [days[0] as string, days[1] as string].map((d) =>
        optionDayPrice("PETR4C11", d, "1.00"),
      ),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const beforeExDate = run.equityCurve.find((p) => p.session === days[2]);
    const onExDate = run.equityCurve.find((p) => p.session === days[3]);
    // The post-split effective quantity doubles the same session the factor's ex-date
    // applies; an unrescaled stale mark would double the leg's value with it, instead of
    // staying flat against the (also stale) price it had the session before.
    expect(onExDate?.equity).toBe(beforeExDate?.equity);
    expect(run.notes).toContainEqual(
      expect.objectContaining({ code: "stale_price_across_corporate_action" }),
    );
  });

  const coveredCall: Structure = {
    id: "covered_call",
    name: "Covered call",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  it("settles a covered call at expiry: the assignment nets exactly against the stock leg, no residual", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "covered_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        coveredCall,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
      quotes: [
        {
          ticker: "PETR4",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          last: decimalString("15.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    expect(op.settlement).toHaveLength(2);
    const stockLeg = op.settlement.find((s) => s.leg.role === "stock");
    const callLeg = op.settlement.find((s) => s.leg.role === "call");
    expect(stockLeg?.outcome).toBe("kept");
    expect(callLeg?.outcome).toBe("assigned");
    expect(callLeg?.fills).toHaveLength(1);
    expect(callLeg?.fills[0]).toMatchObject({ price: decimalString("11.00") });
    // Premium kept (4.50/share) exceeds the stock loss from selling at strike 11 instead of
    // the 15 it was bought at (4.00/share): the covered call nets a small gain.
    expect(op.pnl).toBeGreaterThan(0);
    // No fill for this operation after the expiry session: the assignment's stock sale
    // exactly nets against the stock leg's own quantity, so there is no residual to close.
    const fillsAfterExpiry = run.fills.filter((f) => f.operationId === op.id && f.session > expiry);
    expect(fillsAfterExpiry).toEqual([]);
  });

  it("cash-settles a fractional residual left by a 3:1 grouping across expiry, instead of rounding it away: Σ op.pnl equals final cash minus initial capital", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const grouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[5] as string,
      asOf: `${days[5] as string}T13:00:00.000Z`,
      factor: decimalString("3"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "covered_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        coveredCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [grouping],
      // Entry: 344 shares/contracts at 15.00 on 2024-01-03 — not divisible by the 3:1
      // grouping (ex-date 2024-01-09, before the 2024-01-16 expiry).
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 5 ? "15.00" : "45.00", i < 5 ? "15.00" : "45.00"),
      ),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        // A second, later epoch with the grouped strike (5.00 x 3 = 15.00), dated after the
        // grouping's own ex-date: in real B3 data the registry catches up well before
        // settlement, so by expiry an epoch of its own reflects the factor
        // (option-strike.ts's isFactorReflected). This test exercises residual-settlement
        // math, not strike-derivation confidence.
        callOrPutSeries("PETR4C5", "call", "15.00", expiry, `${days[6] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C5", d, "0.50")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // A covered call's 1:1 stock/option ratio rebases both legs by the same factor (#69 part
    // 2: the assigned call's own 344 contracts become 344 / 3 = 114.666…7 too, not the
    // unrebased 344 an earlier, option-legs-exempt version of this fix left behind), so the
    // stock leg's effective count and the assignment's effective count net to exactly zero —
    // no residual, no next session's own fill. The assignment's own real trade floors to 114
    // whole shares at the derived strike (5.00 x 3 = 15.00); the leftover 0.666…7 of a
    // contract is cash-settled immediately at that same strike, the same way a stock-leg
    // exit's own split residue is (resolvePendingExitFills, ADR-0014 Q51) — an
    // exercise/assignment is a real, immediate trade, so none of its value can wait for a
    // deferred residual close the way the stock leg's own "kept" shares do.
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toBeUndefined();
    const assignmentFill = run.fills.find((f) => f.session === expiry);
    expect(assignmentFill).toMatchObject({
      side: "sell",
      quantity: 114,
      price: decimalString("15.00"),
    });
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    expect(totalPnl).toBe(finalCash - config.initialCapital);
    expect(op.pnl).toBe(centavos(-327353));
    const expiryEquityPoint = run.equityCurve.find((p) => p.session === expiry);
    expect(expiryEquityPoint).toMatchObject({ cash: centavos(672647), equity: centavos(672647) });
  });

  it.each([
    // 1 / 1e-16 = 1e16 effective units, past a safe integer.
    ["effective unit count", "0.0000000000000001"],
    // Issue #285: 1 / 1e-13 = 1e13 units is safe, but at the derived 10.00 strike that is 1e16
    // centavos, past a safe integer.
    ["centavos", "0.0000000000001"],
  ])(
    "settlement reports invalid_input, never throwing, when a corporate-action factor blows an exercised leg's %s past a safe integer",
    (_, tinyFactorValue) => {
      const days = businessDays(20);
      const expiry = days[10] as string;
      const hugeStrikeBase = "100000000000000.00";
      // Ex-dated exactly at expiry, asOf visible only once this same session settles: every
      // earlier session's own mark never sees this factor, so only `resolveExpiringOperations`'s
      // own guard is exercised here, never an intermediate daily mark overflowing `toCentavos` first.
      const tinyFactor: CorporateActionFactor = {
        ticker: "PETR4",
        exDate: expiry,
        asOf: `${expiry}T13:00:00.000Z`,
        factor: decimalString(tinyFactorValue),
      };
      const config = baseConfig({
        strategy: strategyVersion(
          {
            ...definition({
              entry: closeAbove9,
              sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
            }),
            structureId: "single_call",
            strikes: [{ kind: "nearest", price: decimalString(hugeStrikeBase) }],
            expiry: { kind: "business_days", min: 1, max: 12 },
          },
          singleCall,
        ),
        period: { from: days[0] as string, to: days[12] as string },
        // A tiny initial capital against a ~R$1.00 premium buys exactly one contract
        // (fixed_fractional sizes off the run's own current equity, never riskProfile.declaredCapital).
        initialCapital: centavos(100),
      });
      const view: MarketView = {
        ...emptyView,
        calendar: optionCalendar,
        corporateActions: [tinyFactor],
        candles: days.map((d) => candle("PETR4", d, "50.00", "50.00")),
        optionSeries: [
          callOrPutSeries(
            "PETR4CHUGE",
            "call",
            hugeStrikeBase,
            expiry,
            `${days[0] as string}T20:00:00.000Z`,
          ),
        ],
        optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4CHUGE", d, "1.00")),
      };
      const result = runBacktest({ view, config });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_input");
    },
  );

  it("drops an exercised leg's fill, never reporting a trade that never happened, when a factor floors its effective unit count to zero", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const groupingFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[5] as string,
      asOf: `${days[5] as string}T13:00:00.000Z`,
      factor: decimalString("1000"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [groupingFactor],
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 5 ? "10.00" : "6000.00", i < 5 ? "10.00" : "6000.00"),
      ),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        // A second, later epoch with the grouped strike (5.00 x 1000 = 5000.00), dated after
        // the grouping's own ex-date: by expiry the registry's own epoch reflects the factor
        // (option-strike.ts's isFactorReflected). This test exercises the effective-quantity
        // floor, not strike-derivation confidence.
        callOrPutSeries("PETR4C5", "call", "5000.00", expiry, `${days[6] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // A single bought call, 1 contract, a 1000x grouping: the derived strike is 5.00 x 1000 =
    // 5000.00 and the effective quantity (1 / 1000) floors to zero whole shares — the real
    // trade never happens, but the settlement must still say so (no fills reported), with the
    // whole fractional contract cash-settled as a residue instead.
    const settledLeg = op.settlement.find((s) => s.leg.role === "call");
    expect(settledLeg?.fills).toEqual([]);
    const settlementFill = run.fills.find(
      (f) => f.operationId === op.id && f.source === "settlement",
    );
    expect(settlementFill).toBeUndefined();
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  const singlePut: Structure = {
    id: "single_put",
    name: "Long put",
    expiry: "shared",
    legs: [{ role: "put", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
  };

  it("settles a bare exercised long put, no offsetting stock leg, across a non-whole-reciprocal factor: the aggregate residual is short (a sell), not long", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    // A long put's exercise sells the underlying (ADR-0014 Q41): with no stock leg to net
    // against, the operation's own aggregate buyQty/sellQty residual (run-backtest.ts's
    // `resolveExpiringOperations`) nets entirely short, the mirror image of every other
    // settlement test in this file, which all happen to leave a long (buy-side) residual.
    const groupingFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[5] as string,
      asOf: `${days[5] as string}T13:00:00.000Z`,
      factor: decimalString("0.6666666667"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_put",
          strikes: [{ kind: "nearest", price: decimalString("20.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singlePut,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      // A tiny initial capital against a ~R$1.00 premium buys exactly one contract.
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [groupingFactor],
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 5 ? "10.00" : "5.00", i < 5 ? "10.00" : "5.00"),
      ),
      optionSeries: [
        callOrPutSeries("PETR4P20", "put", "20.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4P20", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  it("settles a plain ITM call with no corporate action in effect: a whole effective quantity settles as a single fill with no fractional residue", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00"),
      ),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "0.50")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const settlementFill = run.fills.find(
      (f) => f.operationId === op.id && f.source === "settlement",
    );
    expect(settlementFill?.quantity).toBe(op.legs[0]?.quantity);
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  it("rebases a pending settlement's residual by a split ex-dated the session it is closed on (#273): the residual fill, its pnl and stockGain all land on the post-split scale", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const residualCloseSession = days[11] as string;
    const split: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: residualCloseSession,
      asOf: `${residualCloseSession}T13:00:00.000Z`,
      factor: decimalString("0.5"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      // A tiny initial capital against a ~R$1.00 premium buys exactly one contract.
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [split],
      // ITM at expiry (20.00 > strike 5.00): the bare long call, no stock leg to net
      // against, leaves its whole exercised quantity as a pending residual (ADR-0013
      // "Settlement in a run"), closed the next session at that session's own open — the
      // same session the split's own ex-date falls on.
      candles: days.map((d, i) => {
        if (d === residualCloseSession) return candle("PETR4", d, "12.00", "12.00");
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // The exercise buys 1 share at the 5.00 strike (effective quantity 1, factor still 1 at
    // expiry); the residual (1 share long, avg cost 500 centavos/share) closes the next
    // session, rebased by the 0.5 factor ex-dated exactly there: effective quantity 1 / 0.5 =
    // 2, effective avg cost 500 × 0.5 = 250 centavos/share.
    const residualFill = run.fills.find(
      (f) => f.operationId === op.id && f.session === residualCloseSession,
    );
    expect(residualFill).toMatchObject({
      side: "sell",
      quantity: quantity(2),
      price: decimalString("12.00"),
      source: "next_session_open",
    });
    // residual pnl = (12.00 − 2.50) × 100 × 2 = 1 900; sell costs (gross 2 400, b3Fee 1 +
    // brokerage 100) = 101; pnlSoFar (entry premium −100, settlement costs −100) = −200.
    // op.pnl = 1 900 − 101 − 200 = 1 599. An unrebased residual (the pre-fix bug: 1 share at
    // the raw 500-centavo avg cost) would instead read (12.00 − 5.00) × 100 × 1 − 101 − 200 =
    // 399 — off by exactly the factor this fix applies.
    expect(op.pnl).toBe(centavos(1599));
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  it("cash-settles a fractional residue left by a non-whole-reciprocal factor on a pending settlement's residual, instead of rounding it away", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const residualCloseSession = days[11] as string;
    const groupingFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: residualCloseSession,
      asOf: `${residualCloseSession}T13:00:00.000Z`,
      factor: decimalString("0.6666666667"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [groupingFactor],
      candles: days.map((d, i) => {
        if (d === residualCloseSession) return candle("PETR4", d, "12.00", "12.00");
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // 1 / 0.6666666667 ≈ 1.499999999925 effective shares: 1 whole share trades, the
    // ≈0.5-share residue is cash-settled at the same session's open rather than rounded away
    // or dropped.
    const residualFill = run.fills.find(
      (f) => f.operationId === op.id && f.session === residualCloseSession,
    );
    expect(residualFill).toMatchObject({ side: "sell", quantity: quantity(1) });
    expect(op.pnl).toBe(centavos(999));
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  it("labels a pending residual a grouping dissolves below one share as cash-settled, not traded (#279)", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const residualCloseSession = days[11] as string;
    const grouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: residualCloseSession,
      asOf: `${residualCloseSession}T13:00:00.000Z`,
      factor: decimalString("2"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [grouping],
      candles: days.map((d, i) => {
        if (d === residualCloseSession) return candle("PETR4", d, "40.00", "40.00");
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    if (op?.status !== "expired") throw new Error("expected an expired operation");
    // 1 share / 2 = 0.5 effective shares: nothing trades, the half share is cash-settled.
    expect(
      run.fills.filter((f) => f.operationId === op.id && f.session === residualCloseSession),
    ).toHaveLength(0);
    expect(op.residualSettledBy).toBe("cash");
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });

  it("returns invalid_input, never throwing, when a split factor blows a pending settlement residual's effective unit count past a safe integer", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const residualCloseSession = days[11] as string;
    const microFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: residualCloseSession,
      asOf: `${residualCloseSession}T13:00:00.000Z`,
      factor: decimalString("0.0000000000000001"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [microFactor],
      candles: days.map((d, i) => {
        if (d === residualCloseSession) return candle("PETR4", d, "12.00", "12.00");
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input, never throwing, when that factor reaches the residual's mark on a zero-volume session (#279)", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const residualCloseSession = days[11] as string;
    const microFactor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: residualCloseSession,
      asOf: `${residualCloseSession}T13:00:00.000Z`,
      factor: decimalString("0.0000000000000001"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [microFactor],
      candles: days.map((d, i) => {
        if (d === residualCloseSession) return candle("PETR4", d, "12.00", "12.00", 0);
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  // Issue #285: one exercised share / 1e-14 is a safe 1e14 effective units, but 1e14 x R$5.00
  // or R$12.00 is 5e16 or 1.2e17 centavos, past a safe integer.
  function singleCallWithCentavosOverflowAt(
    exDateIndex: number,
    residualVolume: number,
  ): RunBacktestInput {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const exDate = days[exDateIndex] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("5.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(100),
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [
        {
          ticker: "PETR4",
          exDate,
          asOf: `${exDate}T13:00:00.000Z`,
          factor: decimalString("0.00000000000001"),
        },
      ],
      candles: days.map((d, i) => {
        if (i === 11) return candle("PETR4", d, "12.00", "12.00", residualVolume);
        return candle("PETR4", d, i < 5 ? "10.00" : "20.00", i < 5 ? "10.00" : "20.00");
      }),
      optionSeries: [
        callOrPutSeries("PETR4C5", "call", "5.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("PETR4C5", d, "1.00")),
    };
    return { view, config };
  }

  it.each([
    ["the pending residual's fill", 11, 1000],
    ["the pending residual's mark on a zero-volume session", 11, 0],
  ])(
    "returns invalid_input, never throwing, when a factor leaves a safe unit count but overflows the centavos of %s (#285)",
    (_, exDateIndex, residualVolume) => {
      const result = runBacktest(singleCallWithCentavosOverflowAt(exDateIndex, residualVolume));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_input");
    },
  );

  const bullCallSpread: Structure = {
    id: "bull_call_spread",
    name: "Trava de alta",
    expiry: "shared",
    legs: [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ] as LegTemplate[],
  };

  it("settles a trava de alta at expiry with only the lower strike in the money: the residual long stock closes at the next session's open", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullCallSpread,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    // Underlying sits strictly between the two strikes: the 11-strike call is in the money,
    // the 18-strike call expires worthless.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    const lowLeg = op.settlement.find((s) => s.leg.role === "call" && s.leg.side === "buy");
    const highLeg = op.settlement.find((s) => s.leg.role === "call" && s.leg.side === "sell");
    expect(lowLeg?.outcome).toBe("exercised");
    expect(highLeg?.outcome).toBe("expired_worthless");
    // The exercised leg's own stock buy at strike 11 does not net against anything (the
    // other leg expired worthless, producing no fill): a residual long position remains,
    // closed at the next session's own open, one business day after expiry.
    const nextSession = days[11] as string;
    const residualFill = run.fills.find(
      (f) => f.operationId === op.id && f.session === nextSession,
    );
    expect(residualFill).toMatchObject({ side: "sell", source: "next_session_open" });
  });

  it("taxes a trava de alta's settlement gain the month the residual closes, split into stockGain and optionGain", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullCallSpread,
      ),
      period: { from: days[0] as string, to: days[19] as string },
      costModel: {
        b3FeeRate: decimalString("0.0005"),
        brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(1),
      },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // Entry: buy 1250 PETR4C11 @ 4.50 (cost 281) + sell 1250 PETR4C18 @ 0.50 (cost 31).
    // Settlement (expiry, 2024-01-16): C11 exercised (buy 1250 PETR4 @ 11.00, cost 788),
    // C18 expires worthless (premium 0.50 × 1250 = 62 500 centavos kept, the operation's
    // optionGain, never folded into a stock trade). The exercised leg's own premium loss
    // (-4.50 × 1250 = -562 500) stays with the stock bucket. pnlSoFar (pre-residual) =
    // -562 500 (C11 premium) + 62 500 (C18 premium) - 312 (entry costs) - 788 (settlement
    // cost) = -501 100, deferred since the exercise leaves a 1250-share residual.
    // Residual close (2024-01-17, next session's open @ 15.00, cost 1038):
    // (15.00 - 11.00) × 1250 × 100 - 1038 + (-501 100) = 500 000 - 1038 - 501 100 = -2 138
    // = op.pnl. Split at the fold: stockGain = -2 138 - 62 500 = -64 638 (matches
    // pnlSoFar's non-worthless slice, net of both settlement fills' own costs); optionGain
    // = 62 500 (C18's premium alone).
    expect(op.pnl).toBe(centavos(-2138));
    expect(run.taxes).toEqual([
      {
        month: "2024-01",
        stockSales: centavos(1_875_000),
        stockGain: centavos(-64638),
        optionGain: centavos(62500),
        exemptGain: centavos(0),
        netGain: centavos(-2138),
        tax: centavos(0),
      },
    ]);
  });

  it("carries a pending settlement's residualAvgCostCentavos through a checkpoint resume at full precision, never rounded to a whole centavo", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullCallSpread,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    // Paused right after the expiry session is processed: the trava's residual long stock
    // is a pendingSettlement in the checkpoint, its own residualAvgCostCentavos the exact
    // strike (11.00 × 100 = "1100.000000") since only the exercised leg contributed to
    // buyCost/buyQty here. Mutated to "1100.5" (half a centavo of cost basis per share,
    // never reachable from a real strike × 100 alone, but exactly the shape a genuine
    // multi-source weighted average — a matched stock leg netting against an exercised one
    // — can produce) before resuming: rounding it to 1101 before storing it would
    // silently mis-net the residual's own pnl.
    const paused = runBacktest({ view, config, maxSessions: 11 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");
    const state = paused.value.checkpoint.state as {
      pendingSettlements: Record<string, { residualAvgCostCentavos: string }>;
    };
    const opId = Object.keys(state.pendingSettlements)[0] as string;
    expect(state.pendingSettlements[opId]?.residualAvgCostCentavos).toBe("1100.000000");
    state.pendingSettlements[opId] = {
      ...state.pendingSettlements[opId],
      residualAvgCostCentavos: "1100.5",
    };
    const resumed = runBacktest({
      view,
      config,
      resume: { ...paused.value.checkpoint, state },
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok || resumed.value.status !== "complete") throw new Error("expected complete");
    const op = resumed.value.run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // Residual close (2024-01-17, next session's open @ 15.00, cost 1038): (15.00 −
    // 11.005) × 1250 × 100 − 1038 + pnlSoFar(−501 100) = 499 375 − 1038 − 501 100 = −2 763
    // — exactly 625 centavos (0.5 × 1250) below the exact-cost-basis run's −2 138 (the
    // fixture above), never −2 138 rounded some other way and never the −2 764/-2 762 a
    // half-centavo-per-share rounding of the stored cost basis itself would produce.
    expect(op.pnl).toBe(centavos(-2763));
  });

  it("taxes a worthless long call's premium loss as optionGain, never stockGain", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("50.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[19] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C50", "call", "50.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C50", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // Entry: buy 5000 PETR4C50 @ 1.00 (cost 250). Never in the money (strike 50, spot
    // always 15): expires worthless, no residual, folded the same session. The whole
    // premium (-1.00 × 5000 × 100 = -500 000) is optionGain, not stockGain — only the
    // entry's own transaction cost (250) is left in stockGain.
    expect(op.pnl).toBe(centavos(-500250));
    expect(run.taxes).toEqual([
      {
        month: "2024-01",
        stockSales: centavos(0),
        stockGain: centavos(-250),
        optionGain: centavos(-500000),
        exemptGain: centavos(0),
        netGain: centavos(-500000),
        tax: centavos(0),
      },
    ]);
  });

  const collar: Structure = {
    id: "collar",
    name: "Collar",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 100 },
      { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ] as LegTemplate[],
  };

  it("settles a collar at expiry with both option legs worthless: the whole stock leg is the residual, closed at the next session's open", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "collar",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        collar,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    // Spot stays strictly between the put and call strikes the whole run: at expiry
    // neither option leg is in the money, so both expire worthless and the stock leg
    // (bought at entry, "kept" at settlement) is the entire residual — no netting at all,
    // unlike the trava or covered-call fixtures where an exercised/assigned leg nets
    // against part or all of the stock.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4P11", "put", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P11", d, "0.70")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    expect(op.settlement).toHaveLength(3);
    const stockLeg = op.settlement.find((s) => s.leg.role === "stock");
    const putLeg = op.settlement.find((s) => s.leg.role === "put");
    const callLeg = op.settlement.find((s) => s.leg.role === "call");
    expect(stockLeg?.outcome).toBe("kept");
    expect(putLeg?.outcome).toBe("expired_worthless");
    expect(callLeg?.outcome).toBe("expired_worthless");
    // The stock leg's own quantity is untouched by either settlement (no fills, both legs
    // worthless): the residual closes the whole stock leg at the next session's own open.
    const stockLegQuantity = op.legs.find((l) => l.role === "stock")?.quantity;
    expect(stockLegQuantity).toBe(300);
    const nextSession = days[11] as string;
    const residualFill = run.fills.find(
      (f) => f.operationId === op.id && f.session === nextSession,
    );
    // Entry: buy 300 PETR4 @ 15.00 (cost 325) + buy 3 PETR4P11 @ 0.70 (cost 0) + sell 3
    // PETR4C18 @ 0.50 (cost 0), the stock's fixed_fractional 0.5 budget against the flat
    // 15.00 spot. At expiry neither option strike is touched: the residual is the whole
    // 300-share stock leg, closed at the next session's own open (still 15.00, cost 325).
    // Stock leg's own pnl: (15.00 − 15.00) × 300 × 100 − 325(entry) − 325(exit) = −650.
    // Both options expire worthless: −0.70 × 3 × 100 + 0.50 × 3 × 100 = −60 (optionGain,
    // op.pnl = −650 + (−60) = −710.
    expect(residualFill).toMatchObject({
      side: "sell",
      quantity: stockLegQuantity,
      price: decimalString("15.00"),
      source: "next_session_open",
    });
    expect(op.pnl).toBe(centavos(-710));
    expect(run.taxes[0]?.optionGain).toBe(centavos(-60));
  });

  it("cash-settles a positive fractional residual left by a 3:1 grouping on a collar whose whole stock leg is the residual", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const grouping: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: days[5] as string,
      asOf: `${days[5] as string}T13:00:00.000Z`,
      factor: decimalString("3"),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "collar",
          strikes: [
            { kind: "nearest", price: decimalString("14.00") },
            { kind: "nearest", price: decimalString("26.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        collar,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    // Entry: 200 shares at 20.00 on 2024-01-03 — not divisible by the 3:1 grouping
    // (ex-date 2024-01-09, before the 2024-01-16 expiry). The underlying triples with the
    // grouping (20.00 -> 60.00, matching the covered-call fixture above), and so do both
    // listed strikes once derived, so spot
    // stays strictly between them the whole run: both options expire worthless, and the whole
    // stock leg (effective 200 / 3 = 66.666…7 shares, entry rebased to 60.00/share) is the
    // residual.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [grouping],
      candles: days.map((d, i) =>
        candle("PETR4", d, i < 5 ? "20.00" : "60.00", i < 5 ? "20.00" : "60.00"),
      ),
      optionSeries: [
        callOrPutSeries("PETR4P14", "put", "14.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C26", "call", "26.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        // A second, later epoch per leg with the grouped strike (14.00 x 3 = 42.00,
        // 26.00 x 3 = 78.00), dated after the grouping's own ex-date: by expiry the registry's
        // own epoch reflects the factor (option-strike.ts's isFactorReflected). This test
        // exercises the stock leg's own residual math, not strike-derivation confidence.
        callOrPutSeries("PETR4P14", "put", "42.00", expiry, `${days[6] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C26", "call", "78.00", expiry, `${days[6] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P14", d, "0.70")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C26", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    // Both legs expire worthless at the derived strikes, so this residual is entirely the
    // stock leg's own: 66.666…7 truncates to 66 (matches the residual-close fill below), with
    // a +0.666…7 (+2/3 share) fraction cash-settled at this same expiry session's close
    // (60.00) — the opposite sign from the covered-call fixture above, exercising the other
    // side of the fractional-residue cash settlement.
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toMatchObject({
      side: "sell",
      quantity: 66,
      price: decimalString("60.00"),
      source: "next_session_open",
    });
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    expect(totalPnl).toBe(finalCash - config.initialCapital);
    expect(op.pnl).toBe(centavos(-638));
  });

  it("resolves a pending exit rule for an operation that settled with a deferred residual: a days_before_expiry rule that never filled on a zero-volume expiry session must not throw on the following session", () => {
    const days = businessDays(20);
    const expiry = days[5] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "days_before_expiry", businessDays: 1 }],
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 6 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[8] as string },
      costModel: {
        b3FeeRate: decimalString("0.0005"),
        brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(50) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
    });
    // The underlying stays flat and strictly above the strike (ITM at expiry). The exit
    // rule's own trigger session (index 5, the expiry session itself, one business day out)
    // never trades this option (tradedQuantity 0): resolvePendingExitFills leaves the
    // pending exit unfilled and the operation still open through that same session, then
    // resolveExpiringOperations settles it as an exercise on that same session — before
    // this was fixed, the next session's resolvePendingExitFills still found the
    // now-stale pending exit and threw on its own "a currently open operation" invariant.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days
        .slice(0, 9)
        .map((d, i) => optionDayPrice("PETR4C11", d, "4.50", i === 5 ? 0 : 10)),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    expect(op.settlement).toMatchObject([{ leg: { role: "call" }, outcome: "exercised" }]);
    // Entry: buy 1111 PETR4C11 @ 4.50 (cost 300: fee 250 + brokerage 50). Exercise at
    // strike 11.00: buy 1111 PETR4 @ 11.00 (cost 711: fee 611 + brokerage 100). pnlSoFar =
    // −4.50 × 1111 × 100 (option premium) − 300 (entry costs) − 711 (exercise costs) =
    // −500 961, deferred since the exercise leaves a 1111-share residual. Residual close
    // the next session with real volume (2024-01-10, next session's open @ 15.00, cost
    // 933): (15.00 − 11.00) × 1111 × 100 − 933 + (−500 961) = 444 400 − 933 − 500 961 =
    // −57 494 = op.pnl.
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toMatchObject({
      side: "sell",
      quantity: 1111,
      price: decimalString("15.00"),
      source: "next_session_open",
    });
    expect(op.pnl).toBe(centavos(-57494));
    // stockSales (16 665.00) sits under the default monthly exemption: the whole month is
    // exempt, so a negative stockGain contributes neither an exempt gain nor a taxable one
    // (backtest-taxes.ts clamps exemptGain at 0 and drops stockGain from netGain once
    // exempt), leaving netGain at optionGain alone (0) and no tax.
    expect(run.taxes).toEqual([
      {
        month: "2024-01",
        stockSales: centavos(1_666_500),
        stockGain: centavos(-57494),
        optionGain: centavos(0),
        exemptGain: centavos(0),
        netGain: centavos(0),
        tax: centavos(0),
      },
    ]);
  });

  it("marks a residual at the period_end close when expiry falls on the run's last session (no next session to close it at)", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullCallSpread,
      ),
      period: { from: days[0] as string, to: expiry },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    // No fill trades the residual: it is a mark, not a trade, when the period ends first.
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toBeUndefined();
    expect(op.residualSettledBy).toBe("period_end");
    // A period_end residual is a mark, not a realized trade: it is excluded from both
    // winRate and profitFactor, leaving neither computable from this run's single operation.
    expect(run.metrics.winRate).toBeNull();
    expect(run.metrics.profitFactor).toBeNull();
  });

  // Coverage restoration: resolveOperationExpiry's own missing_instrument
  // path (unreachable from a single, non-resumed view — a series visible at the signal
  // instant is, by resolveSeries's own monotonic asOf, still visible one session later at
  // fill time) is only reachable across a resume whose view has since dropped the series a
  // still-pending (never yet filled) entry depends on.
  it("returns missing_instrument if a resumed run's view omits a still-pending entry's own option leg series at fill time", () => {
    const days = businessDays(20);
    const expiry = days[5] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 6 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const fullView: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 6).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    // Paused after session 0: the entry signal fired and is a pendingEntry, not yet filled
    // (a fill only happens the following session's own open/average).
    const paused = runBacktest({ view: fullView, config, maxSessions: 1 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = {
      ...fullView,
      optionSeries: [],
    };
    const resumed = runBacktest({ view: incompleteView, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("missing_instrument");
  });

  it("returns missing_instrument if a resumed run's view omits an open option leg's series before its expiry", () => {
    const days = businessDays(20);
    const expiry = days[5] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 6 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const fullView: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 6).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const paused = runBacktest({ view: fullView, config, maxSessions: 2 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = {
      ...fullView,
      optionSeries: [],
    };
    const resumed = runBacktest({ view: incompleteView, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("missing_instrument");
  });

  const shortStockProtectiveCall: Structure = {
    id: "short_stock_protective_call",
    name: "Short stock with a protective call",
    expiry: "shared",
    legs: [
      { role: "stock", side: "sell", ratio: 1 },
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  it("settles a short-stock structure whose protective call is exercised in the money, exercising the short-stock-leg accumulation branch", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "short_stock_protective_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        shortStockProtectiveCall,
      ),
      period: { from: days[0] as string, to: days[11] as string },
      riskProfile: {
        declaredCapital: centavos(10_000_00),
        limits: {
          maxLossPerOperation: decimalString("100"),
          maxExposurePerOperation: decimalString("100"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("100"),
        },
      },
    });
    // Underlying above the call's strike: the protective long call is in the money.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
      quotes: [
        {
          ticker: "PETR4",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          last: decimalString("15.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const callLeg = op.settlement.find((s) => s.leg.role === "call");
    expect(callLeg?.outcome).toBe("exercised");
    expect(callLeg?.fills[0]).toMatchObject({ side: "buy", price: decimalString("11.00") });
    // The exercise's stock buy nets exactly against the short stock leg's own quantity.
    const fillsAfterExpiry = run.fills.filter((f) => f.operationId === op.id && f.session > expiry);
    expect(fillsAfterExpiry).toEqual([]);
  });

  const bullPutSpread: Structure = {
    id: "bull_put_spread",
    name: "Trava de alta com puts",
    expiry: "shared",
    legs: [
      { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "put", side: "sell", ratio: 1, strikeRank: 2 },
    ] as LegTemplate[],
  };

  it("settles a bull put spread with only the higher strike in the money: the short put is assigned, the long put expires worthless", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_put_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullPutSpread,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    // Underlying strictly between the two strikes: the 18-strike put is in the money, the
    // 11-strike put expires worthless.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4P11", "put", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4P18", "put", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P11", d, "0.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P18", d, "4.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const lowLeg = op.settlement.find((s) => s.leg.side === "buy");
    const highLeg = op.settlement.find((s) => s.leg.side === "sell");
    expect(lowLeg?.outcome).toBe("expired_worthless");
    expect(highLeg?.outcome).toBe("assigned");
    expect(highLeg?.fills[0]).toMatchObject({ side: "buy", price: decimalString("18.00") });
    // A residual long position remains (the assignment's buy has nothing to net against):
    // closed at the next session's own open.
    const nextSession = days[11] as string;
    const residualFill = run.fills.find(
      (f) => f.operationId === op.id && f.session === nextSession,
    );
    expect(residualFill).toMatchObject({ side: "sell", source: "next_session_open" });
  });

  it("returns insufficient_data if a resumed run's view omits the underlying's own candles at an option operation's expiry", () => {
    const days = businessDays(20);
    const expiry = days[5] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 6 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const fullView: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 6).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const paused = runBacktest({ view: fullView, config, maxSessions: 2 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = { ...fullView, candles: [] };
    const resumed = runBacktest({ view: incompleteView, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("insufficient_data");
  });

  const bearCallSpread: Structure = {
    id: "bear_call_spread",
    name: "Trava de baixa com calls",
    expiry: "shared",
    legs: [
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
    ] as LegTemplate[],
  };

  it("marks a short residual at the period_end close when expiry falls on the run's last session", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bear_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bearCallSpread,
      ),
      period: { from: days[0] as string, to: expiry },
    });
    // Underlying strictly between the two strikes: the lower (short) call is in the money
    // and gets assigned, the higher (long) call expires worthless.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.closedAt).toBe(expiry);
    // No fill trades the residual: it is a mark, not a trade, when the period ends first.
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toBeUndefined();
    expect(op.residualSettledBy).toBe("period_end");
    // A period_end residual is a mark, not a realized trade: it is excluded from both
    // winRate and profitFactor, leaving neither computable from this run's single operation.
    expect(run.metrics.winRate).toBeNull();
    expect(run.metrics.profitFactor).toBeNull();
  });

  it("closes an option operation still open at period_end at its own market mark, before its own expiry", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[3] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 4).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find(
      (o) => o.status === "closed" && o.closeReason.kind === "period_end",
    );
    expect(op).toBeDefined();
    if (op?.status !== "closed") return;
    expect(op.expiry).toBe(expiry);
  });

  it("closes a short option leg early on a stop_loss, buying the call back before expiry", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            exit: [{ kind: "stop_loss", multipleOfMaxLoss: decimalString("0.01") }],
          }),
          structureId: "covered_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        coveredCall,
      ),
      period: { from: days[0] as string, to: days[5] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      // The call's price jumps sharply after entry: the short leg loses value fast enough
      // to trip a tight stop_loss well before the operation's own expiry.
      optionPrices: days
        .slice(0, 5)
        .map((d, i) => optionDayPrice("PETR4C11", d, i <= 1 ? "1.00" : "8.00")),
      quotes: [
        {
          ticker: "PETR4",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          last: decimalString("15.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find(
      (o) => o.status === "closed" && o.closeReason.kind === "exit_rule",
    );
    expect(op).toBeDefined();
    const buyBackFill = run.fills.find(
      (f) => f.operationId === op?.id && f.ticker === "PETR4C11" && f.side === "buy",
    );
    expect(buyBackFill).toMatchObject({ source: "next_session_average" });
  });

  it("retries a short residual's buy-back across a zero-volume session, then closes it at the next session's open", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bear_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bearCallSpread,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d, i) => candle("PETR4", d, "15.00", "15.00", i === 11 ? 0 : 1000)),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 11).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const residualFill = run.fills.find((f) => f.operationId === op.id && f.session > expiry);
    expect(residualFill).toMatchObject({
      side: "buy",
      source: "next_session_open",
      session: days[12],
    });
  });

  const protectivePut: Structure = {
    id: "protective_put",
    name: "Protective put",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  it("settles a protective put whose long put is exercised in the money, exercising the long-put-exercised sell branch", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "protective_put",
          strikes: [{ kind: "nearest", price: decimalString("18.00") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        protectivePut,
      ),
      period: { from: days[0] as string, to: days[11] as string },
    });
    // Underlying below the put's strike: the long put is in the money and gets exercised.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4P18", "put", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4P18", d, "4.50")),
      quotes: [
        {
          ticker: "PETR4",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          last: decimalString("15.00"),
          bid: null,
          ask: null,
        },
      ],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    const putLeg = op.settlement.find((s) => s.leg.role === "put");
    expect(putLeg?.outcome).toBe("exercised");
    expect(putLeg?.fills[0]).toMatchObject({ side: "sell", price: decimalString("18.00") });
    // The exercise's stock sale nets exactly against the long stock leg's own quantity.
    const fillsAfterExpiry = run.fills.filter((f) => f.operationId === op.id && f.session > expiry);
    expect(fillsAfterExpiry).toEqual([]);
  });

  it("retries an option entry across three untraded sessions then records a MissedEntry with reason no_trades (ADR-0014 Q38)", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[4] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "10.00", "10.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      // Priced (so the signal-time selection and sizing preview succeed) but never traded
      // (tradedQuantity 0) for the three retry sessions: the fill itself never happens.
      optionPrices: days
        .slice(0, 5)
        .map((d, i) => optionDayPrice("PETR4C11", d, "1.00", i === 0 ? 10 : 0)),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.fills).toEqual([]);
    expect(run.missedEntries).toHaveLength(1);
    expect(run.missedEntries[0]).toMatchObject({
      ticker: "PETR4",
      sessionsTried: 3,
      reason: "no_trades",
    });
  });

  // no_series_match is reachable at fill time, not only at signal time
  // (already covered in evaluate-strategy.test.ts), when the series a signal selected
  // expires between the signal session and the retry that follows a failed fill.
  it("finalizes a missed entry as no_series_match when the signaled series expires before the failed fill can be retried", () => {
    const days = businessDays(20);
    const expiry = days[1] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 1 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[2] as string },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      // Priced only at the signal session (so the signal-time selection succeeds); no row on
      // the fill session itself, so the fill fails and the pending entry is retried one
      // session later — by which point the only listed series has already expired
      // (business_days min:1 max:1 requires an expiry strictly after that same later
      // session's own instant), leaving no candidate series to re-select: no_series_match,
      // not no_trades.
      optionPrices: [optionDayPrice("PETR4C11", days[0] as string, "1.00")],
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    expect(run.fills).toEqual([]);
    expect(run.missedEntries).toHaveLength(1);
    expect(run.missedEntries[0]).toMatchObject({ ticker: "PETR4", reason: "no_series_match" });
  });

  it("returns insufficient_data (option collection) when a resumed view can't mark an open option leg mid-run", () => {
    const days = businessDays(20);
    const expiry = days[15] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
          expiry: { kind: "business_days", min: 1, max: 18 },
        },
        singleCall,
      ),
      period: { from: days[0] as string, to: days[6] as string },
    });
    const fullView: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 7).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    const paused = runBacktest({ view: fullView, config, maxSessions: 2 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = { ...fullView, optionPrices: [] };
    const resumed = runBacktest({ view: incompleteView, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("insufficient_data");
    if (resumed.error.code !== "insufficient_data") return;
    expect(resumed.error.needed.collections).toEqual(["optionPrices"]);
  });

  it("returns insufficient_data when a resumed view can't mark a still-open settlement residual on a later session", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({ entry: closeAbove9 }),
          structureId: "bull_call_spread",
          strikes: [
            { kind: "nearest", price: decimalString("11.00") },
            { kind: "nearest", price: decimalString("18.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        bullCallSpread,
      ),
      period: { from: days[0] as string, to: days[12] as string },
    });
    const fullView: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00", expiry, `${days[0] as string}T20:00:00.000Z`),
        callOrPutSeries("PETR4C18", "call", "18.00", expiry, `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    // Paused right after the expiry session (index 10 within this period) is processed: the
    // trava's residual long stock is already a pendingSettlement in the checkpoint, not yet
    // traded away at the next session's open.
    const paused = runBacktest({ view: fullView, config, maxSessions: 11 });
    expect(paused.ok).toBe(true);
    if (!paused.ok || paused.value.status !== "paused") throw new Error("expected a paused run");

    const incompleteView: MarketView = { ...fullView, candles: [] };
    const resumed = runBacktest({ view: incompleteView, config, resume: paused.value.checkpoint });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) return;
    expect(resumed.error.code).toBe("insufficient_data");
  });

  // ADR-0063 / #307 review item 2: B3 cash-settles every index option. A long IBOVA183 call
  // held through expiry must book its intrinsic value as cash, never a fill on IBOV itself,
  // and that cash must never count toward a stock sale or its R$ 20k exemption.
  it("cash-settles a long index call at expiry instead of filling the index, with no stock-sales/tax effect", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const zeroFeeCostModel = {
      b3FeeRate: decimalString("0"),
      brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    // Sized to buy exactly one contract: declaredCapital equals the premium's own reais value
    // in centavos, fraction 1.
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("183000") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      universe: ["IBOV"],
      period: { from: days[0] as string, to: days[11] as string },
      costModel: zeroFeeCostModel,
      riskProfile: { ...generousRiskProfile, declaredCapital: centavos(193_05) },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d, i) =>
        candle("IBOV", d, i < 10 ? "180000" : "185000", i < 10 ? "180000" : "185000"),
      ),
      optionSeries: [
        {
          ticker: "IBOVA183",
          underlying: "IBOV",
          right: "call",
          strike: decimalString("183000"),
          expiry,
          style: "european",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          priceFactor: decimalString("100"),
          settlementStyle: "cash",
        },
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("IBOVA183", d, "193.05")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== "complete") throw new Error("expected complete");
    const { run } = result.value;
    const op = run.operations.find((o) => o.status === "expired");
    expect(op).toBeDefined();
    if (op?.status !== "expired") return;
    expect(op.legs).toHaveLength(1);
    const qty = Number(op.legs[0]?.quantity);
    expect(qty).toBeGreaterThan(0);

    const settledLeg = op.settlement[0];
    expect(settledLeg?.outcome).toBe("exercised");
    expect(settledLeg?.fills).toEqual([]);
    expect(settledLeg?.cashSettlementValue).toBe(centavos(20_00 * qty));

    expect(op.pnl).toBe(centavos((20_00 - 193_05) * qty));

    const ibovFills = run.fills.filter((f) => f.ticker === "IBOV");
    expect(ibovFills).toEqual([]);

    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    expect(totalPnl).toBe(finalCash - config.initialCapital);
    expect(run.taxes.every((t) => t.stockSales === 0)).toBe(true);
  });

  it("returns invalid_input, never throws, when a factor ex-dated before expiry leaves a cash-settled leg's rebased cash flow past a safe integer of centavos", () => {
    const days = businessDays(20);
    const expiry = days[10] as string;
    const zeroFeeCostModel = {
      b3FeeRate: decimalString("0"),
      brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
      optionSlippageRate: decimalString("0"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    };
    const config = baseConfig({
      strategy: strategyVersion(
        {
          ...definition({
            entry: closeAbove9,
            sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
          }),
          structureId: "single_call",
          strikes: [{ kind: "nearest", price: decimalString("183000") }],
          expiry: { kind: "business_days", min: 1, max: 12 },
        },
        singleCall,
      ),
      initialCapital: centavos(200_00),
      universe: ["IBOV"],
      period: { from: days[0] as string, to: days[11] as string },
      costModel: zeroFeeCostModel,
      riskProfile: { ...generousRiskProfile, declaredCapital: centavos(200_00) },
    });
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d, i) =>
        candle("IBOV", d, i < 10 ? "180000" : "185000", i < 10 ? "180000" : "185000"),
      ),
      corporateActions: [
        {
          ticker: "IBOV",
          exDate: days[5] as string,
          asOf: `${days[5] as string}T13:00:00.000Z`,
          factor: decimalString("0.00000000001"),
        },
      ],
      optionSeries: [
        {
          ticker: "IBOVA183",
          underlying: "IBOV",
          right: "call",
          strike: decimalString("183000"),
          expiry,
          style: "european",
          asOf: `${days[0] as string}T20:00:00.000Z`,
          priceFactor: decimalString("100"),
          settlementStyle: "cash",
        },
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("IBOVA183", d, "2.00")),
    };
    const result = runBacktest({ view, config });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
    expect(result.error).toMatchObject({ path: "view.corporateActions" });
  });
});
