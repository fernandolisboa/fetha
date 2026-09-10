import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  MarketView,
  OptionDayPrice,
  OptionSeries,
  RunBacktestInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString } from "../test/support";

// A hand-built option fixture, not a fast-check arbitrary: #23 lands the option seam this
// checks I1/I2/I7 against, and a full arbitrary generator for strike/expiry selection,
// option series and day prices is a separate, larger undertaking than this ticket's scope
// (tracked as a follow-up rather than risked here). This still exercises the exact code
// paths the stock-only arbitraries do (fills, marks, the equity curve, checkpoints), just
// over one deterministic option structure instead of a generated one.

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
const calendar: TradingSession[] = days.map((date) => ({
  date,
  open: `${date}T13:00:00.000Z`,
  close: `${date}T20:00:00.000Z`,
}));

const expiry = days[15] as string;

const singleCall: Structure = {
  id: "single_call",
  name: "Long call",
  expiry: "shared",
  legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
};

const closeAbove9: Condition = {
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "constant", value: decimalString("9") },
};

const definition: StrategyDefinition = {
  name: "test",
  timeframe: "D1",
  entry: closeAbove9,
  structureId: "single_call",
  strikes: [{ kind: "nearest", price: decimalString("11.00") }],
  expiry: { kind: "business_days", min: 1, max: 18 },
  sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
  exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.2") }],
  adjustments: [],
};

const strategy: StrategyVersion = { id: "v1", definition, structure: singleCall };

const optionSeries: OptionSeries = {
  ticker: "PETR4C11",
  underlying: "PETR4",
  right: "call",
  strike: decimalString("11.00"),
  expiry,
  style: "european",
  asOf: `${days[0] as string}T20:00:00.000Z`,
};

function optionDayPrice(session: string, average: string): OptionDayPrice {
  return {
    ticker: "PETR4C11",
    session,
    asOf: `${session}T20:00:00.000Z`,
    average: decimalString(average),
    close: decimalString(average),
    trades: 1,
    tradedQuantity: 10,
  };
}

function baseView(periodEnd: number): MarketView {
  return {
    calendar,
    candles: days.slice(0, periodEnd + 1).map((d) => ({
      ticker: "PETR4",
      timeframe: "D1",
      session: d,
      asOf: `${d}T20:00:00.000Z`,
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 1000,
    })),
    corporateActions: [],
    optionSeries: [optionSeries],
    optionPrices: days
      .slice(0, periodEnd + 1)
      .map((d, i) => optionDayPrice(d, i <= 1 ? "1.00" : "3.00")),
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}

function config(periodTo: string) {
  return {
    strategy,
    universe: ["PETR4" as const],
    period: { from: days[0] as string, to: periodTo },
    initialCapital: centavos(10_000_00),
    costModel: {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(0) },
      optionSlippageRate: decimalString("0"),
      incomeTaxRate: decimalString("0.15"),
      monthlyStockSalesExemption: centavos(2_000_000_00),
    },
    riskProfile: {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    },
    limits: "enforce" as const,
    sizing: null,
    walkForward: null,
    seed: 1,
  };
}

const stripTruncated = (run: { provenance: { truncated: unknown } }) => ({
  ...run,
  provenance: { ...run.provenance, truncated: [] },
});

describe("I1 Future-blind — an option structure through runBacktest", () => {
  it("appending an option day price and series row with asOf after period.to's close never changes the run", () => {
    const periodTo = days[6] as string;
    const view = baseView(6);

    const base = runBacktest({ view, config: config(periodTo) });
    expect(base.ok).toBe(true);
    if (!base.ok || base.value.status !== "complete") throw new Error("expected complete");

    const futureAsOf = `${days[19] as string}T20:00:00.001Z`;
    const extendedView: MarketView = {
      ...view,
      optionPrices: [
        ...view.optionPrices,
        { ...optionDayPrice(days[19] as string, "999.00"), asOf: futureAsOf },
      ],
      optionSeries: [
        ...view.optionSeries,
        { ...optionSeries, ticker: "PETR4C99", strike: decimalString("99.00"), asOf: futureAsOf },
      ],
    };
    const extended = runBacktest({ view: extendedView, config: config(periodTo) });
    expect(extended.ok).toBe(true);
    if (!extended.ok || extended.value.status !== "complete") throw new Error("expected complete");

    expect(stripTruncated(extended.value.run)).toEqual(stripTruncated(base.value.run));
  });
});

describe("I2 Chunk-invariance — an option structure through runBacktest", () => {
  it("any maxSessions split reproduces the same run as one uninterrupted call", () => {
    const periodTo = days[10] as string;
    const view = baseView(10);
    const wholeConfig = config(periodTo);

    const whole = runBacktest({ view, config: wholeConfig });
    expect(whole.ok).toBe(true);
    if (!whole.ok || whole.value.status !== "complete") throw new Error("expected complete");

    for (const maxSessions of [1, 2, 3, 4]) {
      let resume: RunBacktestInput["resume"] | undefined;
      let last: ReturnType<typeof runBacktest> | null = null;
      for (let iterations = 0; iterations < 20; iterations += 1) {
        const step = runBacktest(
          resume === undefined
            ? { view, config: wholeConfig, maxSessions }
            : { view, config: wholeConfig, maxSessions, resume },
        );
        expect(step.ok).toBe(true);
        if (!step.ok) throw new Error("expected ok");
        last = step;
        if (step.value.status === "complete") break;
        resume = step.value.checkpoint;
      }
      if (!last?.ok || last.value.status !== "complete") throw new Error("expected complete");
      expect(stripTruncated(last.value.run)).toEqual(stripTruncated(whole.value.run));
    }
  });
});

describe("I7 Prefix-consistency — an option structure through runBacktest", () => {
  it("a run stopped before expiry agrees on every fill with the full run's own prefix up to that same session", () => {
    const shortPeriodTo = days[3] as string;
    const longPeriodTo = days[6] as string;

    const shortRun = runBacktest({ view: baseView(3), config: config(shortPeriodTo) });
    const longRun = runBacktest({ view: baseView(6), config: config(longPeriodTo) });
    expect(shortRun.ok).toBe(true);
    expect(longRun.ok).toBe(true);
    if (!shortRun.ok || shortRun.value.status !== "complete") throw new Error("expected complete");
    if (!longRun.ok || longRun.value.status !== "complete") throw new Error("expected complete");

    const longFillsUpToCut = longRun.value.run.fills.filter((f) => f.session <= shortPeriodTo);
    expect(shortRun.value.run.fills).toEqual(longFillsUpToCut);
  });
});
