import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, StrategyDefinition, Structure } from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  LegSettlement,
  MarketView,
  Operation,
  OptionDayPrice,
  OptionSeries,
  RunBacktestInput,
  StrategyVersion,
  TradingSession,
} from "../api";
import { proposeSettlement } from "../internal/propose-settlement";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString } from "../test/support";

// #72: resolveExpiringOperations (run-backtest.ts) delegates its own ITM/intrinsic/outcome
// decision to propose-settlement.ts's settleLeg, the same one proposeSettlement itself uses.
// This property checks the two callers never disagree: for a collar reaching its own expiry
// inside a run, proposeSettlement's own settlement decision for that same operation, read off
// the same MarketView, matches the run's own settlement — every field except a fill's own
// `costs` (the run overlays its cost model on a bare, cost-free settlement fill; a standalone
// proposal never does, ADR-0013's #25 addendum).

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

const generousRiskProfile = {
  declaredCapital: centavos(10_000_00),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 5,
    maxPremiumBought: decimalString("1"),
  },
};

function candle(ticker: string, date: string, close: string): Candle {
  return {
    ticker,
    timeframe: "D1",
    session: date,
    asOf: `${date}T20:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
}

function callOrPutSeries(ticker: string, right: "call" | "put", strike: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf: `${days[0] as string}T20:00:00.000Z`,
  };
}

function optionDayPrice(ticker: string, sessionDate: string): OptionDayPrice {
  return {
    ticker,
    session: sessionDate,
    asOf: `${sessionDate}T20:00:00.000Z`,
    average: decimalString("0.70"),
    close: decimalString("0.70"),
    trades: 1,
    tradedQuantity: 10,
  };
}

function buildConfig(putStrike: string, callStrike: string): BacktestConfig {
  const definition: StrategyDefinition = {
    name: "test",
    timeframe: "D1",
    entry: closeAbove9,
    structureId: "collar",
    strikes: [
      { kind: "nearest", price: decimalString(putStrike) },
      { kind: "nearest", price: decimalString(callStrike) },
    ],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [],
    adjustments: [],
    expiry: { kind: "business_days", min: 1, max: 12 },
  };
  const strategy: StrategyVersion = { id: "v1", definition, structure: collar };
  return {
    strategy,
    universe: ["PETR4"],
    period: { from: days[0] as string, to: days[11] as string },
    initialCapital: centavos(10_000_00),
    costModel: {
      b3FeeRate: decimalString("0.0005"),
      brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(50) },
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

// Strictly increasing (put strike < call strike): resolve-leg-selection.ts refuses a collar
// whose two ranks resolve to the same or a decreasing strike (`degenerate_strikes`) — a
// structural constraint of the collar itself, unrelated to what this property checks. With the
// underlying flat at 15.00, this still reaches every settlement outcome combination a collar can
// have except both legs in the money at once, which putStrike < callStrike rules out by
// construction (the same mutual exclusion a real collar has).
const strikePairArbitrary = fc
  .tuple(fc.integer({ min: 500, max: 2500 }), fc.integer({ min: 500, max: 2500 }))
  .filter(([a, b]) => a !== b)
  .map(([a, b]): [string, string] => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return [decimalString((lo / 100).toFixed(2)), decimalString((hi / 100).toFixed(2))];
  });

function stripFillCosts(legs: readonly LegSettlement[]): unknown {
  return legs.map((leg) => ({
    ...leg,
    fills: leg.fills.map((fill) => ({ ...fill, costs: null })),
  }));
}

describe("settleLeg delegation (#72)", () => {
  it("proposeSettlement agrees with the run's own settlement, modulo a fill's own costs", () => {
    fc.assert(
      fc.property(strikePairArbitrary, ([putStrike, callStrike]) => {
        const view: MarketView = {
          ...emptyView,
          calendar: optionCalendar,
          candles: days.map((d) => candle("PETR4", d, "15.00")),
          optionSeries: [
            callOrPutSeries("PETR4P", "put", putStrike),
            callOrPutSeries("PETR4C", "call", callStrike),
          ],
          optionPrices: [
            ...days.slice(0, 12).map((d) => optionDayPrice("PETR4P", d)),
            ...days.slice(0, 12).map((d) => optionDayPrice("PETR4C", d)),
          ],
        };
        const input: RunBacktestInput = { view, config: buildConfig(putStrike, callStrike) };
        const result = runBacktest(input);
        if (!result.ok || result.value.status !== "complete") {
          throw new Error("expected a complete run");
        }
        const op = result.value.run.operations.find((o) => o.status === "expired");
        if (op?.status !== "expired") throw new Error("expected an expired operation");

        const proposal = proposeSettlement(
          {
            view,
            operation: {
              id: op.id,
              underlying: op.underlying,
              legs: op.legs,
              expiry: op.expiry,
              openedAt: op.openedAt,
              strategyVersionId: op.strategyVersionId,
              rolledFrom: op.rolledFrom,
            } satisfies Operation,
          },
          {
            engineVersion: "0.1.0",
            pricingModel: "bsm_continuous_yield",
            dataVersion: null,
            datasetNotes: [],
          },
        );
        expect(proposal.ok).toBe(true);
        if (!proposal.ok) return;
        expect(proposal.value.expiry).toBe(expiry);
        expect(stripFillCosts(proposal.value.legs)).toEqual(stripFillCosts(op.settlement));
      }),
      { numRuns: 50 },
    );
  });
});
