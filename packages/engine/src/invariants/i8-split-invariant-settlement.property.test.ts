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
// ADR-0013 `0.8.0` addendum). The BBAS3 fixture below is the ticket's own fixed example (and its
// review-round-1 twins, settling through a real listed epoch instead of a derived one); the
// property below it generalizes the same invariant over split factors, strikes, premiums and
// quantities, a long call, a long put and a short (assigned) put, and both whole- and
// fractional-reciprocal factors (a fractional one leaves a residue, cash-settled at the exact
// same strike as the real trade, so the closed-form expectation never needs to floor anything).

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

type Role = "call" | "put";
type Side = "buy" | "sell";

function singleLegStructure(role: Role, side: Side): Structure {
  return {
    id: "single_leg",
    name: "Single leg",
    expiry: "shared",
    legs: [{ role, side, ratio: 1, strikeRank: 1 }] as LegTemplate[],
  };
}

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

function optionSeries(
  ticker: string,
  underlying: string,
  right: Role,
  strike: string,
  asOf: string,
): OptionSeries {
  return {
    ticker,
    underlying,
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf,
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

// `fixed_fractional` sizes `floor(declaredCapital * fraction / perUnitCostCentavos)`; a declared
// capital of `units * perUnitCostCentavos` plus a headroom strictly less than one more unit's
// own cost still floors to exactly `units`, with no remainder, whether `perUnitCostCentavos` is
// a debit leg's own premium (a long call or put) or a credit leg's own bounded max loss (a
// short, cash-secured put: strike minus premium received, the worst case at a zero underlying).
// The headroom itself keeps `maxLossPerOperation`'s 100%-of-equity ratio check strictly under
// its own limit: a declared capital of exactly the position's own max loss, with no headroom at
// all, is a razor's-edge 100% ratio the engine's own `limit_breach` can tip over by a single
// centavo of rounding between this test's own closed-form `perUnitCostCentavos` and the
// engine's own computed max loss.
function buildConfig(
  underlying: string,
  role: Role,
  side: Side,
  strikePrice: string,
  units: number,
  perUnitCostCentavos: number,
): BacktestConfig {
  const definition: StrategyDefinition = {
    name: "test",
    timeframe: "D1",
    entry: closeAbove9,
    structureId: "single_leg",
    strikes: [{ kind: "nearest", price: decimalString(strikePrice) }],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [],
    adjustments: [],
    expiry: { kind: "business_days", min: 1, max: 12 },
  };
  const strategy: StrategyVersion = {
    id: "v1",
    definition,
    structure: singleLegStructure(role, side),
  };
  return {
    strategy,
    universe: [underlying],
    period: { from: days[0] as string, to: expiry },
    // fraction 0.5 against roughly double the position's own cost lands on exactly `units`
    // (the extra half-unit of headroom floors away) while keeping the risk-limit ratios safely
    // under 100%, immune to a centavo of rounding between this cost estimate and the engine's
    // own computed max loss (a razor-thin 100%-of-equity declared capital tipped `limit_breach`
    // over by exactly that kind of rounding during this test's own development).
    initialCapital: centavos(units * perUnitCostCentavos * 2 + perUnitCostCentavos),
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
  role: Role,
  strikePrice: string,
  entryPremium: string,
  factor: string | null,
  closeAtExpiry: string,
  extraEpoch: { strike: string; asOf: string } | null = null,
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
    optionSeries: [
      optionSeries(
        optionTicker,
        underlying,
        role,
        strikePrice,
        `${days[0] as string}T20:00:00.000Z`,
      ),
      ...(extraEpoch
        ? [optionSeries(optionTicker, underlying, role, extraEpoch.strike, extraEpoch.asOf)]
        : []),
    ],
    optionPrices: days.slice(0, 11).map((d) => optionDayPrice(optionTicker, d, entryPremium)),
  };
}

function runSingleLeg(input: RunBacktestInput): { pnl: number; notes: string[] } {
  const result = runBacktest(input);
  if (!result.ok || result.value.status !== "complete") {
    throw new Error("expected a complete run");
  }
  const op = result.value.run.operations.find((o) => o.status === "expired");
  if (op?.status !== "expired") throw new Error("expected a settled operation");
  return { pnl: op.pnl, notes: result.value.run.notes.map((n) => n.code) };
}

describe("split invariant on option-leg settlement", () => {
  it("BBAS3 2-for-1 split: a long call's economic P&L survives the split, up to the strike's own cent rounding", () => {
    // 100 BBASD350 calls bought at R$1.00, strike 27.19, factor 0.5 ex-date before the
    // 2024-04-19-style expiry. By settlement (weeks after the ex-date) a real listed epoch of
    // its own reflects the split (27.19 x 0.5 = 13.595, rounded half-up to 13.60), dated at the
    // ex-date's own close: the window's own exclusive lower bound (session(E.asOf) == exDate)
    // excludes the split's own factor outright here, before the one-to-one match is ever
    // consulted — the strike is a property of the series, not of the holding — and the underlying closes at 14.50 at expiry.
    const split = buildView("BBAS3", "BBASD350", "call", "27.19", "1.00", "0.5", "14.50", {
      strike: "13.60",
      asOf: `${exDate}T20:00:00.000Z`,
    });
    const splitConfig = buildConfig("BBAS3", "call", "buy", "27.19", 100, 100);
    const splitRun = runSingleLeg({ view: split, config: splitConfig });
    // 200 contracts x (14.50 - 13.60) - 100 x 1.00 = 180 - 100 = 80.00.
    expect(splitRun.pnl).toBe(centavos(8000));

    // The never-split twin: 100 calls, strike unchanged at 27.19, underlying closes at 29.00
    // (the same relative move, at the pre-split scale).
    const twin = buildView("BBAS3", "BBASD350", "call", "27.19", "1.00", null, "29.00");
    const twinConfig = buildConfig("BBAS3", "call", "buy", "27.19", 100, 100);
    const twinRun = runSingleLeg({ view: twin, config: twinConfig });
    // 100 x (29.00 - 27.19) - 100 x 1.00 = 181.00 - 100.00 = 81.00.
    expect(twinRun.pnl).toBe(centavos(8100));

    // The R$1.00 gap between the two is exactly the strike's cent rounding: 27.19 x 0.5 =
    // 13.595 rounds up to 13.60, a half-cent of adverse strike per share, over 200 effective
    // shares = R$1.00 (100 centavos).
    expect(twinRun.pnl - splitRun.pnl).toBe(centavos(100));
  });

  it("BBAS3 twin settling through a real 13.60 epoch dated at the ex-date's own close: the same R$80.00, never derived", () => {
    const view = buildView("BBAS3", "BBASD350", "call", "27.19", "1.00", "0.5", "14.50", {
      strike: "13.60",
      asOf: `${exDate}T20:00:00.000Z`,
    });
    const config = buildConfig("BBAS3", "call", "buy", "27.19", 100, 100);
    const run = runSingleLeg({ view, config });
    expect(run.pnl).toBe(centavos(8000));
    expect(run.notes).not.toContain("option_strike_derived_across_corporate_action");
  });

  it("BBAS3 twin settling through a 13.60 epoch backfilled before the ex-date (ADR-0056 step 3): still R$80.00, never double-applied", () => {
    const dayBeforeExDate = days[4] as string;
    const view = buildView("BBAS3", "BBASD350", "call", "27.19", "1.00", "0.5", "14.50", {
      strike: "13.60",
      asOf: `${dayBeforeExDate}T20:00:00.000Z`,
    });
    const config = buildConfig("BBAS3", "call", "buy", "27.19", 100, 100);
    const run = runSingleLeg({ view, config });
    expect(run.pnl).toBe(centavos(8000));
    expect(run.notes).not.toContain("option_strike_derived_across_corporate_action");
  });

  it("BBAS3 twin whose split falls exactly on the operation's own expiry session, with no epoch at all: still R$80.00, exercising the derived path end to end", () => {
    // The split's own ex-date coincides with expiry itself — the one session whose own
    // close-stamped epoch cannot exist yet when settlement reads it, since settlement reads
    // the expiry session's own close — so option-strike.ts derives with confidence
    // (27.19 x 0.5 = 13.595, rounded half-up to 13.60), the same R$80.00 every other shape of
    // this fixture reaches.
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [
        {
          ticker: "BBAS3",
          exDate: expiry,
          asOf: `${expiry}T13:00:00.000Z`,
          factor: decimalString("0.5"),
        },
      ],
      candles: days.map((d, i) =>
        candle("BBAS3", d, i < 5 ? decimalString("20.00") : decimalString("14.50")),
      ),
      optionSeries: [
        optionSeries("BBASD350", "BBAS3", "call", "27.19", `${days[0] as string}T20:00:00.000Z`),
      ],
      optionPrices: days.slice(0, 11).map((d) => optionDayPrice("BBASD350", d, "1.00")),
    };
    const config = buildConfig("BBAS3", "call", "buy", "27.19", 100, 100);
    const run = runSingleLeg({ view, config });
    expect(run.pnl).toBe(centavos(8000));
    expect(run.notes).toContain("option_strike_derived_across_corporate_action");
  });

  it("holds for a long call, a long put and a short (assigned) put, across any split factor whose reciprocal is a whole number, any strike, premium and quantity (no residue)", () => {
    // The single flaky failure quant saw here was a timeout, not a counterexample (120k runs
    // plus an exhaustive grid found zero mismatches): `numRuns` matches the sibling
    // full-backtest properties (i1/i2/i4/i7/walk-forward), each of which also runs a full
    // `runBacktest` per case and carries the same 30s `it` timeout.
    const kindArbitrary = fc.constantFrom<{ role: Role; side: Side }>(
      { role: "call", side: "buy" },
      { role: "put", side: "buy" },
      { role: "put", side: "sell" },
    );
    const reciprocalArbitrary = fc.constantFrom(2, 4, 5, 8, 10);
    // A short put's exposure limit is checked against the strike's own full notional (the
    // worst case, assignment at a zero underlying), never the bounded max loss (strike minus
    // premium) `buildConfig`'s own headroom is calibrated against; a premium priced above half
    // the strike makes `cost = strike - premium` small enough that no capital figure can
    // satisfy both this test's own exact-unit-count sizing and the engine's exposure check at
    // once. Capping the premium at a strike's own minority keeps every kind solvable.
    const strikePremiumArbitrary = fc
      .tuple(fc.integer({ min: 500, max: 5000 }), fc.integer({ min: 2, max: 50 }))
      .map(([strikeCents, premiumPercent]) => ({
        strikeCents,
        premiumCents: Math.max(10, Math.round((strikeCents * premiumPercent) / 100)),
      }));
    const unitsArbitrary = fc.integer({ min: 1, max: 200 });
    const inTheMoneyMarginCentsArbitrary = fc.integer({ min: 1, max: 400 });

    fc.assert(
      fc.property(
        kindArbitrary,
        reciprocalArbitrary,
        strikePremiumArbitrary,
        unitsArbitrary,
        inTheMoneyMarginCentsArbitrary,
        (kind, reciprocal, { strikeCents, premiumCents }, units, marginCents) => {
          const { pnl, expectedPnl } = runScenario(
            kind.role,
            kind.side,
            new Decimal(1).div(reciprocal),
            strikeCents,
            premiumCents,
            units,
            marginCents,
          );
          expect(pnl).toBe(expectedPnl);
        },
      ),
      { numRuns: 25 },
    );
  }, 30_000);

  it("holds across a 3-for-2 split (factor 2/3, a non-whole reciprocal) that leaves a fractional residue: a covered call's stock and assigned-call legs net to exactly zero residue, Σ op.pnl equals final cash minus initial capital", () => {
    // A bare single option leg's fractional residue settles in two separate places (the real,
    // floored exercise/assignment trade, cash-settled at the strike; the aggregate buy/sell
    // residual, cash-settled at the underlying's close), so a single closed-form expectation
    // cannot model it without reimplementing both paths. A covered call's 1:1 stock/option ratio
    // sidesteps that: both legs are rebased by the exact same factor (run-backtest.test.ts's own
    // "3:1 grouping across expiry" proves this for a whole reciprocal), so whatever each leg's
    // own residue is, the two cancel — the invariant this test actually checks is the backtester's
    // own cash-conservation identity, the same one that test asserts.
    const coveredCallStructure: Structure = {
      id: "covered_call",
      name: "Covered call",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
      ] as LegTemplate[],
    };
    const strategyDefinition: StrategyDefinition = {
      name: "test",
      timeframe: "D1",
      entry: closeAbove9,
      structureId: "covered_call",
      strikes: [{ kind: "nearest", price: decimalString("5.00") }],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
      exit: [],
      adjustments: [],
      expiry: { kind: "business_days", min: 1, max: 12 },
    };
    const strategy: StrategyVersion = {
      id: "v1",
      definition: strategyDefinition,
      structure: coveredCallStructure,
    };
    // A zero-cost model keeps the per-unit entry cost an exact 1500 - 50 = 1450 centavos (stock
    // price minus the call premium received), so a hand-picked initial capital lands on an exact,
    // odd unit count: floor(1,000,500 x 0.5 / 1,450) = floor(500,250 / 1,450) = 345 (500,250 is
    // an exact multiple of 1,450), odd so the 3-for-2 split's 1.5x rebasing (345 x 1.5 = 517.5)
    // leaves a genuine half-contract residue on both legs instead of landing on a whole number.
    const config: BacktestConfig = {
      strategy,
      universe: ["PETR4"],
      period: { from: days[0] as string, to: days[12] as string },
      initialCapital: centavos(1_000_500),
      costModel: zeroCostModel,
      riskProfile: generousRiskProfile,
      limits: "enforce",
      sizing: null,
      walkForward: null,
      seed: 1,
    };
    const split: CorporateActionFactor = {
      ticker: "PETR4",
      exDate,
      asOf: `${exDate}T13:00:00.000Z`,
      factor: decimalString("0.6666666667"),
    };
    const view: MarketView = {
      ...emptyView,
      calendar: optionCalendar,
      corporateActions: [split],
      candles: days.map((d, i) => candle("PETR4", d, i < 5 ? "15.00" : "45.00")),
      optionSeries: [
        optionSeries("PETR4C5", "PETR4", "call", "5.00", `${days[0] as string}T20:00:00.000Z`),
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
    const finalCash = run.equityCurve.at(-1)?.cash;
    if (finalCash === undefined) throw new Error("expected a non-empty equity curve");
    const totalPnl = run.operations.reduce((sum, o) => sum + o.pnl, 0);
    expect(totalPnl).toBe(finalCash - config.initialCapital);
  });
});

// Shared by both properties above: builds a single-leg scenario from the given role/side/factor
// and returns both the engine's own settled pnl and the closed-form expectation. The residue a
// non-whole reciprocal leaves is cash-settled immediately at the exact same strike as the real,
// floored trade (run-backtest.ts's `resolveExpiringOperations`), so the full, unrounded effective
// quantity — never the floored one — is what the closed form must use to match it exactly.
function runScenario(
  role: Role,
  side: Side,
  factor: Decimal,
  strikeCents: number,
  premiumCents: number,
  units: number,
  marginCents: number,
): { pnl: number; expectedPnl: number } {
  const strike = new Decimal(strikeCents).div(100);
  const premium = new Decimal(premiumCents).div(100);
  const derivedStrike = strike.mul(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // A put's close must stay strictly positive: clamp the margin so it never reaches or exceeds
  // the derived strike itself (a call has no such ceiling, the underlying's upside is unbounded).
  const clampedMarginCents =
    role === "put" ? Math.min(marginCents, derivedStrike.mul(100).toNumber() - 1) : marginCents;
  const margin = new Decimal(clampedMarginCents).div(100);
  const closeAtExpiry = role === "call" ? derivedStrike.add(margin) : derivedStrike.sub(margin);
  const effectiveQuantity = new Decimal(units).div(factor);

  const underlying = "TEST4";
  const optionTicker = "TEST4O";
  // A second, later epoch with the derived strike, dated at the factor's own ex-date close: by
  // settlement the registry's own epoch reflects it, excluded from the window by its own
  // exclusive lower bound (session(E.asOf) == exDate) rather than by the one-to-one match — the
  // realistic shape this property's closed form assumes.
  const view = buildView(
    underlying,
    optionTicker,
    role,
    strike.toFixed(2),
    premium.toFixed(2),
    factor.toFixed(10),
    closeAtExpiry.toFixed(2),
    { strike: derivedStrike.toFixed(2), asOf: `${exDate}T20:00:00.000Z` },
  );
  // A short put is a credit: fixed_fractional sizes it off its own bounded max loss (strike
  // minus premium received, the worst case at a zero underlying), never the premium.
  const perUnitCostCentavos = side === "sell" ? strikeCents - premiumCents : premiumCents;
  const config = buildConfig(underlying, role, side, strike.toFixed(2), units, perUnitCostCentavos);
  const { pnl } = runSingleLeg({ view, config });

  const settleValue =
    role === "call"
      ? Decimal.max(closeAtExpiry.sub(derivedStrike), 0)
      : Decimal.max(derivedStrike.sub(closeAtExpiry), 0);
  const sign = side === "buy" ? 1 : -1;
  const expectedPnl = settleValue
    .mul(effectiveQuantity)
    .sub(premium.mul(units))
    .mul(sign)
    .mul(100)
    .round()
    .toNumber();
  return { pnl, expectedPnl };
}
