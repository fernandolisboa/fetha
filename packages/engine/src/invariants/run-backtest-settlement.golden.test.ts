import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  MarketView,
  OptionDayPrice,
  OptionSeries,
  RunBacktestInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString } from "../test/support";

// Locks the exact `settlement[]`, `fills` and `pnl` runBacktest produces today for the trava
// (bull call spread), collar and covered-call fixtures already exercised in
// run-backtest.test.ts's "#23" describe block. #72 moves resolveExpiringOperations's own
// ITM/intrinsic/outcome decision to propose-settlement.ts's settleLeg; this file is the
// before/after guard that move must leave byte-identical (recorded before the refactor, kept
// running after it).

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

const days = businessDays(20);
const optionCalendar: TradingSession[] = days.map((date) => ({
  date,
  open: `${date}T13:00:00.000Z`,
  close: `${date}T20:00:00.000Z`,
}));
const expiry = days[10] as string;

function candle(ticker: string, date: string, open: string, close: string): Candle {
  return {
    ticker,
    timeframe: "D1",
    session: date,
    asOf: `${date}T20:00:00.000Z`,
    open: decimalString(open),
    high: decimalString(close > open ? close : open),
    low: decimalString(close < open ? close : open),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
}

function callOrPutSeries(
  ticker: string,
  right: "call" | "put",
  strike: string,
  underlying = "PETR4",
): OptionSeries {
  return {
    ticker,
    underlying,
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf: `${days[0] as string}T20:00:00.000Z`,
  };
}

function optionDayPrice(ticker: string, sessionDate: string, average: string): OptionDayPrice {
  return {
    ticker,
    session: sessionDate,
    asOf: `${sessionDate}T20:00:00.000Z`,
    average: decimalString(average),
    close: decimalString(average),
    trades: 1,
    tradedQuantity: 10,
  };
}

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

const closeAbove9: Condition = {
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "constant", value: decimalString("9") },
};

const generousRiskProfile = {
  declaredCapital: centavos(10_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 5,
    maxPremiumBought: decimalString("1"),
  },
};

function config(structureId: string, structure: Structure, strikes: string[]): BacktestConfig {
  const definition: StrategyDefinition = {
    name: "test",
    timeframe: "D1",
    entry: closeAbove9,
    structureId,
    strikes: strikes.map((price) => ({ kind: "nearest" as const, price: decimalString(price) })),
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [],
    adjustments: [],
    expiry: { kind: "business_days", min: 1, max: 12 },
  };
  const strategy: StrategyVersion = { id: "v1", definition, structure };
  return {
    strategy,
    universe: ["PETR4"],
    period: { from: days[0] as string, to: days[11] as string },
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
  };
}

function runAndSnapshot(input: RunBacktestInput, filename: string): Promise<void> {
  const result = runBacktest(input);
  if (!result.ok || result.value.status !== "complete") {
    throw new Error("expected a complete run for the golden fixture");
  }
  const { run } = result.value;
  const expired = run.operations.filter((o) => o.status === "expired");
  const expiredIds = new Set(expired.map((o) => o.id));
  const payload = {
    operations: expired.map((o) => ({
      status: o.status,
      closedAt: o.closedAt,
      pnl: o.pnl,
      settlement: o.settlement,
    })),
    fills: run.fills.filter(
      (f) =>
        expiredIds.has(f.operationId) &&
        (f.source === "settlement" || f.source === "next_session_open"),
    ),
    taxes: run.taxes,
  };
  return expect(JSON.stringify(payload, null, 2) + "\n").toMatchFileSnapshot(
    `./__golden__/${filename}`,
  );
}

describe("runBacktest settlement golden fixtures (#72)", () => {
  const coveredCall: Structure = {
    id: "covered_call",
    name: "Covered call",
    expiry: "shared",
    legs: [
      { role: "stock", side: "buy", ratio: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
    ] as LegTemplate[],
  };

  it("covered call: assignment nets exactly against the stock leg", async () => {
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [callOrPutSeries("PETR4C11", "call", "11.00")],
      optionPrices: days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
    };
    await runAndSnapshot(
      { view, config: config("covered_call", coveredCall, ["11.00"]) },
      "covered-call.json",
    );
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

  it("collar: both option legs worthless, the whole stock leg is the residual", async () => {
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4P11", "put", "11.00"),
        callOrPutSeries("PETR4C18", "call", "18.00"),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P11", d, "0.70")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    await runAndSnapshot(
      { view, config: config("collar", collar, ["11.00", "18.00"]) },
      "collar.json",
    );
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

  it("trava de alta: only the lower strike in the money", async () => {
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      candles: days.map((d) => candle("PETR4", d, "15.00", "15.00")),
      optionSeries: [
        callOrPutSeries("PETR4C11", "call", "11.00"),
        callOrPutSeries("PETR4C18", "call", "18.00"),
      ],
      optionPrices: [
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C11", d, "4.50")),
        ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C18", d, "0.50")),
      ],
    };
    await runAndSnapshot(
      { view, config: config("bull_call_spread", bullCallSpread, ["11.00", "18.00"]) },
      "bull-call-spread.json",
    );
  });
});
