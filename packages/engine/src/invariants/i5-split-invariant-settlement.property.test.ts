import Decimal from "decimal.js";
import fc from "fast-check";
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
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString } from "../test/support";

// #69 part 2: a corporate action on the underlying must not change an operation's economic
// P&L beyond the strike's own cent rounding (B3's own rounding on a split-adjusted strike,
// ADR-0013 addendum). The BBAS3 fixture below is the ticket's own fixed example; the property
// below it generalizes the same invariant over a range of split factors, strikes, premiums and
// quantities chosen so the share count divides evenly (no fractional-residue noise), so the
// expected P&L is computable in closed form and must match the engine's own output exactly.

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
const exDate = days[5] as string;
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

const singleCall: Structure = {
  id: "single_call",
  name: "Long call",
  expiry: "shared",
  legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }] as LegTemplate[],
};

const zeroCostModel = {
  b3FeeRate: decimalString("0"),
  brokerage: { stockPerOrder: centavos(0), optionPerOrder: centavos(0) },
  optionSlippageRate: decimalString("0"),
  incomeTaxRate: decimalString("0"),
  monthlyStockSalesExemption: centavos(999_999_999_00),
};

const generousRiskProfile = {
  declaredCapital: centavos(1),
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

function callSeries(ticker: string, underlying: string, strike: string): OptionSeries {
  return {
    ticker,
    underlying,
    right: "call",
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

// Buys exactly `units` contracts: `fixed_fractional` sizes
// `floor(declaredCapital * fraction / premiumPerUnitCentavos)`, so a declared capital of
// exactly `units * premiumCentavos` with `fraction: 1` lands on `units` with no remainder.
function buildConfig(
  underlying: string,
  strikePrice: string,
  entryPremium: string,
  units: number,
): BacktestConfig {
  const premiumCentavos = new Decimal(entryPremium).mul(100).toNumber();
  const definition: StrategyDefinition = {
    name: "test",
    timeframe: "D1",
    entry: closeAbove9,
    structureId: "single_call",
    strikes: [{ kind: "nearest", price: decimalString(strikePrice) }],
    sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
    exit: [],
    adjustments: [],
    expiry: { kind: "business_days", min: 1, max: 12 },
  };
  const strategy: StrategyVersion = { id: "v1", definition, structure: singleCall };
  return {
    strategy,
    universe: [underlying],
    period: { from: days[0] as string, to: expiry },
    initialCapital: centavos(units * premiumCentavos),
    costModel: zeroCostModel,
    riskProfile: generousRiskProfile,
    limits: "enforce",
    sizing: null,
    walkForward: null,
    seed: 1,
  };
}

function buildView(
  underlying: string,
  optionTicker: string,
  strikePrice: string,
  entryPremium: string,
  factor: string | null,
  closeAtExpiry: string,
): MarketView {
  return {
    ...emptyView,
    calendar: optionCalendar,
    corporateActions:
      factor === null
        ? []
        : ([
            {
              ticker: underlying,
              exDate,
              asOf: `${exDate}T13:00:00.000Z`,
              factor: decimalString(factor),
            },
          ] satisfies CorporateActionFactor[]),
    candles: days.map((d, i) =>
      candle(underlying, d, i < 5 ? decimalString("20.00") : closeAtExpiry),
    ),
    optionSeries: [callSeries(optionTicker, underlying, strikePrice)],
    optionPrices: days.slice(0, 11).map((d) => optionDayPrice(optionTicker, d, entryPremium)),
  };
}

function runSingleCall(input: RunBacktestInput): { pnl: number } {
  const result = runBacktest(input);
  if (!result.ok || result.value.status !== "complete") {
    throw new Error("expected a complete run");
  }
  const op = result.value.run.operations.find((o) => o.status === "expired");
  if (op?.status !== "expired") throw new Error("expected a settled operation");
  return { pnl: op.pnl };
}

describe("split invariant on option-leg settlement (#69 part 2)", () => {
  it("BBAS3 2-for-1 split: a long call's economic P&L survives the split, up to the strike's own cent rounding", () => {
    // 100 BBASD350 calls bought at R$1.00, strike 27.19, factor 0.5 ex-date before the
    // 2024-04-19-style expiry; the series carries no epoch of its own reflecting the split
    // (option-strike.ts derives it: 27.19 x 0.5 = 13.595, rounded half-up to 13.60), the
    // underlying closes at 14.50 at expiry.
    const split = buildView("BBAS3", "BBASD350", "27.19", "1.00", "0.5", "14.50");
    const splitConfig = buildConfig("BBAS3", "27.19", "1.00", 100);
    const splitRun = runSingleCall({ view: split, config: splitConfig });
    // 200 contracts x (14.50 - 13.60) - 100 x 1.00 = 180 - 100 = 80.00.
    expect(splitRun.pnl).toBe(centavos(8000));

    // The never-split twin: 100 calls, strike unchanged at 27.19, underlying closes at 29.00
    // (the same relative move, at the pre-split scale).
    const twin = buildView("BBAS3", "BBASD350", "27.19", "1.00", null, "29.00");
    const twinConfig = buildConfig("BBAS3", "27.19", "1.00", 100);
    const twinRun = runSingleCall({ view: twin, config: twinConfig });
    // 100 x (29.00 - 27.19) - 100 x 1.00 = 181.00 - 100.00 = 81.00.
    expect(twinRun.pnl).toBe(centavos(8100));

    // The R$1.00 gap between the two is exactly the strike's cent rounding: 27.19 x 0.5 =
    // 13.595 rounds up to 13.60, a half-cent of adverse strike per share, over 200 effective
    // shares = R$1.00 (100 centavos).
    expect(twinRun.pnl - splitRun.pnl).toBe(centavos(100));
  });

  it("holds for any split factor whose reciprocal is a whole number, any strike, premium and quantity (no residue)", () => {
    const reciprocalArbitrary = fc.constantFrom(2, 4, 5, 8, 10);
    const strikeCentsArbitrary = fc.integer({ min: 500, max: 5000 });
    const premiumCentsArbitrary = fc.integer({ min: 10, max: 500 });
    const unitsArbitrary = fc.integer({ min: 1, max: 200 });
    const inTheMoneyMarginCentsArbitrary = fc.integer({ min: 1, max: 5000 });

    fc.assert(
      fc.property(
        reciprocalArbitrary,
        strikeCentsArbitrary,
        premiumCentsArbitrary,
        unitsArbitrary,
        inTheMoneyMarginCentsArbitrary,
        (reciprocal, strikeCents, premiumCents, units, marginCents) => {
          const factor = new Decimal(1).div(reciprocal);
          const strike = new Decimal(strikeCents).div(100);
          const premium = new Decimal(premiumCents).div(100);
          const derivedStrike = strike.mul(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          const closeAtExpiry = derivedStrike.add(new Decimal(marginCents).div(100));
          const effectiveUnits = units * reciprocal;

          const underlying = "TEST4";
          const optionTicker = "TEST4C";
          const view = buildView(
            underlying,
            optionTicker,
            strike.toFixed(2),
            premium.toFixed(2),
            factor.toFixed(10),
            closeAtExpiry.toFixed(2),
          );
          const config = buildConfig(underlying, strike.toFixed(2), premium.toFixed(2), units);
          const { pnl } = runSingleCall({ view, config });

          const expectedPnl = closeAtExpiry
            .sub(derivedStrike)
            .mul(effectiveUnits)
            .sub(premium.mul(units))
            .mul(100)
            .round()
            .toNumber();
          expect(pnl).toBe(expectedPnl);
        },
      ),
      { numRuns: 100 },
    );
  });
});
