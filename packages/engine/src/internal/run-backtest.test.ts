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
      // The engineVersion must actually match (ENGINE_VERSION, not a hardcoded literal
      // that could drift out of sync with it — round 2 item 9), or this test would pass
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

  it("returns invalid_input instead of throwing when a resumed chunk's view carries a non-positive corporate-action factor (round 3 item 4)", () => {
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
    // Round 2 item 4: a pendingSettlements entry only ever exists for a residual still
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
    // Round 2 item 5: residualAvgCostCentavos is a DecimalString (full precision), never a
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

  it("notes option_strike_unadjusted_across_corporate_action when a split falls inside an option-legged operation's life (item 18, round 1 — Q51 gap, no series-rollover support yet)", () => {
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

  it("taxes a trava de alta's settlement gain the month the residual closes, split into stockGain and optionGain (items 10, 11, round 1)", () => {
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
        brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(0) },
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

  it("carries a pending settlement's residualAvgCostCentavos through a checkpoint resume at full precision, never rounded to a whole centavo (round 2 item 5)", () => {
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
    // — can produce) before resuming: rounding it to 1101 before storing it, as round 2
    // item 5 found, would silently mis-net the residual's own pnl.
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

  it("taxes a worthless long call's premium loss as optionGain, never stockGain (item 11, round 1)", () => {
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

  it("settles a collar at expiry with both option legs worthless: the whole stock leg is the residual, closed at the next session's open (item 9, round 1)", () => {
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
    // item 11, round 1). op.pnl = −650 + (−60) = −710.
    expect(residualFill).toMatchObject({
      side: "sell",
      quantity: stockLegQuantity,
      price: decimalString("15.00"),
      source: "next_session_open",
    });
    expect(op.pnl).toBe(centavos(-710));
    expect(run.taxes[0]?.optionGain).toBe(centavos(-60));
  });

  it("resolves a pending exit rule for an operation that settled with a deferred residual (round 2 item 1): a days_before_expiry rule that never filled on a zero-volume expiry session must not throw on the following session", () => {
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
        brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(50) },
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
    // round 2 item 1's fix, the next session's resolvePendingExitFills still found the
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
});
