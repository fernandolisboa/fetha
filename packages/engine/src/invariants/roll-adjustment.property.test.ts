import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  AdjustmentRule,
  CostModel,
  LegTemplate,
  RiskProfile,
  StrategyDefinition,
  Structure,
} from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  CorporateActionFactor,
  MarketView,
  OptionSeries,
  TradingSession,
} from "../api";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString, quantity } from "../test/support";

// #383: a roll's own close/reopen is exercised against a small, deterministic covered-call
// fixture (the golden in run-backtest.test.ts carries the hand-computed cash flows); these two
// properties instead vary one input across many runs, the way CLAUDE.md asks of engine math.

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

function businessDays(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(2024, 0, 2));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function session(date: string): TradingSession {
  return { date, open: `${date}T13:00:00.000Z`, close: `${date}T21:00:00.000Z` };
}

function candle(ticker: string, date: string, close: string): Candle {
  return {
    ticker,
    timeframe: "D1",
    session: date,
    asOf: `${date}T21:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
}

function optionSeries(ticker: string, strike: string, expiry: string, asOf: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right: "call",
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf,
  };
}

function optionDayPrice(ticker: string, sessionDate: string, average: string) {
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

const coveredCall: Structure = {
  id: "covered_call_roll_property",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ] as LegTemplate[],
};

const rollRule: AdjustmentRule = {
  kind: "roll",
  when: { kind: "days_before_expiry", businessDays: 5 },
  expiry: { kind: "business_days", min: 20, max: 25 },
  strikes: [{ kind: "nearest", price: decimalString("11.00") }],
};

function definition(fraction: string): StrategyDefinition {
  return {
    name: "covered-call-roll",
    timeframe: "D1",
    structureId: "covered_call_roll_property",
    entry: closeAbove9,
    strikes: [{ kind: "nearest", price: decimalString("11.00") }],
    expiry: { kind: "business_days", min: 1, max: 16 },
    sizing: { kind: "fixed_fractional", fraction: decimalString(fraction) },
    exit: [],
    adjustments: [rollRule],
  };
}

function riskProfile(declaredCapital: number): RiskProfile {
  return {
    declaredCapital: centavos(declaredCapital),
    limits: {
      maxLossPerOperation: decimalString("1"),
      maxExposurePerOperation: decimalString("1"),
      maxOpenOperations: 5,
      maxPremiumBought: decimalString("1"),
    },
  };
}

const closeAbove9 = {
  kind: "compare" as const,
  left: { kind: "price" as const, field: "close" as const },
  comparator: ">" as const,
  right: { kind: "constant" as const, value: decimalString("9") },
};

function fixture(costModel: CostModel, declaredCapitalCentavos: number, extraDays: number) {
  const days = businessDays(40 + extraDays);
  const nearExpiry = days[15] as string;
  const farExpiry = days[32] as string;
  const periodTo = days[12] as string;
  const config: BacktestConfig = {
    strategy: {
      id: "v1",
      definition: definition("0.09"),
      structure: coveredCall,
    },
    universe: ["PETR4"],
    period: { from: days[0] as string, to: periodTo },
    initialCapital: centavos(declaredCapitalCentavos),
    costModel,
    riskProfile: riskProfile(declaredCapitalCentavos),
    limits: "enforce",
    sizing: null,
    walkForward: null,
    seed: 1,
  };
  const view: MarketView = {
    ...emptyView,
    calendar: days.map(session),
    candles: days.map((d) => candle("PETR4", d, "10.00")),
    optionSeries: [
      optionSeries("PETR4C11", "11.00", nearExpiry, `${days[0] as string}T20:00:00.000Z`),
      optionSeries("PETR4C11F", "11.00", farExpiry, `${days[0] as string}T20:00:00.000Z`),
    ],
    optionPrices: [
      ...days.slice(0, 16).map((d) => optionDayPrice("PETR4C11", d, "1.00")),
      ...days.slice(0, 33).map((d) => optionDayPrice("PETR4C11F", d, "1.20")),
    ],
  };
  return { config, view, days };
}

describe("Roll adjustment — no look-ahead", () => {
  it("appending a candle and a corporate-action factor with asOf after the run's period.to close never changes the run", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (extraDays) => {
        const costModel: CostModel = {
          b3FeeRate: decimalString("0.0005"),
          brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
          optionSlippageRate: decimalString("0.01"),
          incomeTaxRate: decimalString("0.15"),
          monthlyStockSalesExemption: centavos(2_000_000_00),
        };
        const { config, view, days } = fixture(costModel, 1_000_000, extraDays);
        const lastDay = days[days.length - 1] as string;

        const baseResult = runBacktest({ view, config });

        const futureCandle: Candle = candle("PETR4", "2099-01-01", "999.00");
        const futureFactor: CorporateActionFactor = {
          ticker: "PETR4",
          exDate: days[0] as string,
          asOf: `${lastDay}T23:59:59.999Z`,
          factor: decimalString("0.5"),
        };
        const extendedResult = runBacktest({
          view: {
            ...view,
            candles: [...view.candles, futureCandle],
            corporateActions: [...view.corporateActions, futureFactor],
          },
          config,
        });

        expect(baseResult.ok).toBe(true);
        expect(extendedResult.ok).toBe(true);
        if (!baseResult.ok || !extendedResult.ok) return;
        if (baseResult.value.status !== "complete" || extendedResult.value.status !== "complete") {
          throw new Error("expected both runs to complete");
        }
        const stripTruncated = (run: typeof baseResult.value.run) => ({
          ...run,
          provenance: { ...run.provenance, truncated: [] },
        });
        expect(stripTruncated(extendedResult.value.run)).toEqual(
          stripTruncated(baseResult.value.run),
        );
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});

describe("Roll adjustment — scale invariance of quantities and cash", () => {
  it("scales the rolled operation's and the reopened operation's pnl by the same positive integer factor as the sizing capital, with a brokerage-free cost model so every cost is itself proportional to gross", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (k) => {
        const costModel: CostModel = {
          b3FeeRate: decimalString("0.0005"),
          brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
          optionSlippageRate: decimalString("0.01"),
          incomeTaxRate: decimalString("0.15"),
          monthlyStockSalesExemption: centavos(2_000_000_00),
        };
        const base = fixture(costModel, 1_000_000, 0);
        const scaled = fixture(costModel, 1_000_000 * k, 0);

        const baseResult = runBacktest({ view: base.view, config: base.config });
        const scaledResult = runBacktest({ view: scaled.view, config: scaled.config });
        expect(baseResult.ok).toBe(true);
        expect(scaledResult.ok).toBe(true);
        if (!baseResult.ok || !scaledResult.ok) return;
        if (baseResult.value.status !== "complete" || scaledResult.value.status !== "complete") {
          throw new Error("expected both runs to complete");
        }

        const baseRolled = baseResult.value.run.operations.find(
          (op) => op.status === "closed" && op.closeReason.kind === "rolled",
        );
        const scaledRolled = scaledResult.value.run.operations.find(
          (op) => op.status === "closed" && op.closeReason.kind === "rolled",
        );
        expect(baseRolled).toBeDefined();
        expect(scaledRolled).toBeDefined();
        if (baseRolled === undefined || scaledRolled === undefined) return;

        expect(scaledRolled.pnl).toBe(centavos(baseRolled.pnl * k));
        const scaledCallLeg = scaledRolled.legs.find((leg) => leg.role === "call");
        const baseCallLeg = baseRolled.legs.find((leg) => leg.role === "call");
        expect(scaledCallLeg?.quantity).toBe(quantity((baseCallLeg?.quantity ?? 0) * k));

        const baseReopened = baseResult.value.run.operations.find(
          (op) => op.status === "closed" && op.closeReason.kind === "period_end",
        );
        const scaledReopened = scaledResult.value.run.operations.find(
          (op) => op.status === "closed" && op.closeReason.kind === "period_end",
        );
        expect(baseReopened).toBeDefined();
        expect(scaledReopened).toBeDefined();
        if (baseReopened === undefined || scaledReopened === undefined) return;
        expect(scaledReopened.pnl).toBe(centavos(baseReopened.pnl * k));
      }),
      { numRuns: 20 },
    );
  });
});
