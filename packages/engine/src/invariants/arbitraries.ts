import Decimal from "decimal.js";
import fc from "fast-check";
import type {
  Centavos,
  Condition,
  DecimalString,
  LegTemplate,
  StrategyDefinition,
  Structure,
} from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  OptionDayPrice,
  OptionSeries,
  StrategyVersion,
  TradingSession,
} from "../api";
import { assertDefined } from "../internal/invariant";

const decimalString = (value: string): DecimalString => value as DecimalString;

const sessionAt = (index: number): string => {
  const d = new Date(Date.UTC(2024, 0, 1 + index));
  return d.toISOString().slice(0, 10);
};

export const candlePriceArbitrary = fc
  .integer({ min: 100, max: 100_000 })
  .map((cents) => decimalString((cents / 100).toFixed(2)));

export const ohlcArbitrary = fc
  .tuple(
    candlePriceArbitrary,
    candlePriceArbitrary,
    fc.integer({ min: 0, max: 500 }),
    fc.integer({ min: 0, max: 500 }),
  )
  .map(([open, close, highExtraCents, lowExtraCents]) => {
    const openD = new Decimal(open);
    const closeD = new Decimal(close);
    const highExtra = new Decimal(highExtraCents).div(100);
    const lowExtra = new Decimal(lowExtraCents).div(100);
    const high = Decimal.max(openD, closeD).add(highExtra);
    const rawLow = Decimal.min(openD, closeD).sub(lowExtra);
    const low = rawLow.lte(0) ? new Decimal("0.01") : rawLow;
    return {
      open,
      close,
      high: decimalString(high.toFixed(2)),
      low: decimalString(low.toFixed(2)),
    };
  });

export const candleSeriesArbitrary: fc.Arbitrary<Candle[]> = fc
  .array(ohlcArbitrary, { minLength: 5, maxLength: 20 })
  .map((ohlcs) =>
    ohlcs.map((ohlc, i) => {
      const session = sessionAt(i);
      const candle: Candle = {
        ticker: "PETR4",
        timeframe: "D1",
        session,
        asOf: `${session}T21:00:00.000Z`,
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        tradedQuantity: 1000 + i,
      };
      return candle;
    }),
  );

// `candleSeriesArbitrary` plus up to three restated daily candles (#38, ADR-0055): a later version
// of a drawn session, published between one minute and three days after the first, each at its own
// instant (a millisecond offset keeps every asOf distinct from a session close and from each other).
export const restatedCandleSeriesArbitrary: fc.Arbitrary<Candle[]> = fc
  .tuple(
    candleSeriesArbitrary,
    fc.array(
      fc.record({
        index: fc.nat(),
        lagMinutes: fc.integer({ min: 1, max: 3 * 24 * 60 }),
        ohlc: ohlcArbitrary,
      }),
      { minLength: 1, maxLength: 3 },
    ),
  )
  .map(([candles, restatements]) => [
    ...candles,
    ...restatements.map(({ index, lagMinutes, ohlc }, k): Candle => {
      const first = assertDefined(candles[index % candles.length], "arbitraries: drawn session");
      const asOf = new Date(Date.parse(first.asOf) + lagMinutes * 60_000 + k + 1).toISOString();
      return { ...first, ...ohlc, asOf };
    }),
  ]);

const centavos = (value: number): Centavos => value as Centavos;

// Long enough to exercise annualization (MIN_ANNUALIZED_SESSIONS is 126 per ADR-0013), one
// business-day-shaped calendar per index so a random maxSessions split has plenty of room.
export const BACKTEST_FIXTURE_SESSIONS = 130;

function backtestSessionAt(index: number): TradingSession {
  const date = sessionAt(index);
  return { date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` };
}

const priceWalkArbitrary = fc
  .array(fc.integer({ min: -300, max: 300 }), {
    minLength: BACKTEST_FIXTURE_SESSIONS,
    maxLength: BACKTEST_FIXTURE_SESSIONS,
  })
  .map((deltasCents) => {
    let price = new Decimal("20.00");
    return deltasCents.map((deltaCents) => {
      price = price.add(new Decimal(deltaCents).div(100));
      if (price.lte("1.00")) price = new Decimal("1.00");
      return decimalString(price.toFixed(2));
    });
  });

const exitFractionArbitrary = fc
  .integer({ min: 2, max: 20 })
  .map((percent) => decimalString((percent / 100).toFixed(2)));

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
};

const alwaysTrueEntry: Condition = {
  kind: "compare",
  left: { kind: "price", field: "close" },
  comparator: ">",
  right: { kind: "constant", value: decimalString("0") },
};

export type LongBacktestFixture = {
  config: BacktestConfig;
  calendar: TradingSession[];
  candles: Candle[];
  cdiAnnualRate: DecimalString;
};

// A long, randomly walking price series with a non-zero CDI and a real exit rule: enough to
// exercise annualized sharpe/cagr and give a chunked run and a prefix run something non-trivial
// to diverge on if the checkpoint state is wrong (I2, I7) — pendingExits and realized sales
// sometimes in flight at the cut, not only a single buy-and-hold leg — without the arbitrary
// itself needing to model limits realistically, since those invariants are about the resumption
// plumbing, not about strategy behavior.
// One in ten sessions draws zero volume: a fill or a mark that skips such a session (retried, or
// simply absent for that day's candle) is exactly the path I1/I2/I7 need exercised alongside the
// happy path of every session trading.
const zeroVolumeFlagsArbitrary = fc.array(fc.integer({ min: 0, max: 9 }), {
  minLength: BACKTEST_FIXTURE_SESSIONS,
  maxLength: BACKTEST_FIXTURE_SESSIONS,
});

export const longBacktestFixtureArbitrary: fc.Arbitrary<LongBacktestFixture> = fc
  .tuple(
    priceWalkArbitrary,
    exitFractionArbitrary,
    fc.integer({ min: 100, max: 3000 }),
    fc.integer({ min: 1, max: 2000 }),
    zeroVolumeFlagsArbitrary,
    fc.integer({ min: 1, max: 70 }),
  )
  .map(
    ([
      prices,
      exitFraction,
      cdiBasisPoints,
      initialCapitalReais,
      zeroVolumeFlags,
      windowSessions,
    ]) => {
      const calendar: TradingSession[] = [];
      const candles: Candle[] = [];
      for (let i = 0; i < BACKTEST_FIXTURE_SESSIONS; i += 1) {
        const s = backtestSessionAt(i);
        calendar.push(s);
        const price = assertDefined(prices[i], "arbitraries: index within bounds");
        const isZeroVolume =
          assertDefined(zeroVolumeFlags[i], "arbitraries: index within bounds") === 0;
        candles.push({
          ticker: "PETR4",
          timeframe: "D1",
          session: s.date,
          asOf: s.close,
          open: price,
          high: price,
          low: price,
          close: price,
          tradedQuantity: isZeroVolume ? 0 : 1000,
        });
      }
      const definition: StrategyDefinition = {
        name: "buy, take profit and re-enter",
        timeframe: "D1",
        structureId: "stock",
        strikes: [],
        sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        entry: alwaysTrueEntry,
        exit: [{ kind: "profit_target", fractionOfPremium: exitFraction }],
        adjustments: [],
      };
      const strategy: StrategyVersion = { id: "v1", definition, structure: stockStructure };
      const first = assertDefined(calendar[0], "arbitraries: non-empty calendar");
      const last = assertDefined(calendar.at(-1), "arbitraries: non-empty calendar");
      const config: BacktestConfig = {
        strategy,
        universe: ["PETR4"],
        period: { from: first.date, to: last.date },
        initialCapital: centavos(initialCapitalReais * 100_00),
        costModel: {
          b3FeeRate: decimalString("0.0005"),
          brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
          optionSlippageRate: decimalString("0"),
          incomeTaxRate: decimalString("0.15"),
          // Low enough that a month's own stock sales — even at the smallest end of
          // initialCapitalReais's range — realistically breach it at least once across a
          // property run's numRuns draws, so I7 actually exercises a taxable month instead of
          // one that is always exempt.
          monthlyStockSalesExemption: centavos(500_00),
        },
        riskProfile: {
          declaredCapital: centavos(initialCapitalReais * 100_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
        limits: "enforce",
        sizing: null,
        walkForward: { windowSessions },
        seed: 1,
      };
      return {
        config,
        calendar,
        candles,
        cdiAnnualRate: decimalString((cdiBasisPoints / 10000).toFixed(6)),
      };
    },
  );

const coveredCallRollStructure: Structure = {
  id: "covered_call_roll_fixture",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ] as LegTemplate[],
};

export type RollBacktestFixture = {
  config: BacktestConfig;
  calendar: TradingSession[];
  candles: Candle[];
  optionSeries: OptionSeries[];
  optionPrices: OptionDayPrice[];
  nearExpiry: string;
  farExpiry: string;
};

// A covered call that rolls once partway through a long-enough calendar for a chunked
// (I2) or cut-short (I1, I7) run to land before, exactly on, or after the roll's own fill
// session (#383 round-1 review item 6): unlike `longBacktestFixtureArbitrary` above, this one
// carries option legs and a roll rule, so the resumption plumbing those three invariants test is
// exercised with a `pendingRoll` in flight, not only `pendingExits`/`pendingEntries`. The
// underlying stays flat (no price-walk arbitrary): a roll's own series/strike selection already
// has its own dedicated property coverage in roll-adjustment.property.test.ts, so this fixture
// only needs the roll to reliably fire and fill, not to vary the market around it.
export const rollBacktestFixtureArbitrary: fc.Arbitrary<RollBacktestFixture> = fc
  .tuple(fc.integer({ min: 5_000, max: 50_000 }), fc.integer({ min: 0, max: 15 }))
  .map(([declaredCapitalReais, extraDays]) => {
    const sessionCount = 45 + extraDays;
    const calendar: TradingSession[] = [];
    const candles: Candle[] = [];
    for (let i = 0; i < sessionCount; i += 1) {
      const date = sessionAt(i);
      calendar.push({ date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` });
      candles.push({
        ticker: "PETR4",
        timeframe: "D1",
        session: date,
        asOf: `${date}T20:00:00.000Z`,
        open: decimalString("10.00"),
        high: decimalString("10.00"),
        low: decimalString("10.00"),
        close: decimalString("10.00"),
        tradedQuantity: 1000,
      });
    }
    const nearExpiry = assertDefined(calendar[15], "arbitraries: sessionCount > 15").date;
    const farExpiry = assertDefined(calendar[35], "arbitraries: sessionCount > 35").date;
    const firstAsOf = assertDefined(calendar[0], "arbitraries: non-empty calendar").open;

    const optionSeries: OptionSeries[] = [
      {
        ticker: "PETR4C11",
        underlying: "PETR4",
        right: "call",
        strike: decimalString("11.00"),
        expiry: nearExpiry,
        style: "european",
        asOf: firstAsOf,
      },
      {
        ticker: "PETR4C11F",
        underlying: "PETR4",
        right: "call",
        strike: decimalString("11.00"),
        expiry: farExpiry,
        style: "european",
        asOf: firstAsOf,
      },
    ];
    const optionDayPrice = (ticker: string, session: TradingSession): OptionDayPrice => ({
      ticker,
      session: session.date,
      asOf: session.close,
      average: decimalString("1.00"),
      close: decimalString("1.00"),
      trades: 1,
      tradedQuantity: 10,
    });
    const optionPrices: OptionDayPrice[] = [
      ...calendar.slice(0, 16).map((s) => optionDayPrice("PETR4C11", s)),
      ...calendar.slice(0, 36).map((s) => optionDayPrice("PETR4C11F", s)),
    ];

    const definition: StrategyDefinition = {
      name: "covered call, rolled once",
      timeframe: "D1",
      structureId: "covered_call_roll_fixture",
      entry: alwaysTrueEntry,
      strikes: [{ kind: "nearest", price: decimalString("11.00") }],
      expiry: { kind: "business_days", min: 1, max: 16 },
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [
        {
          kind: "roll",
          when: { kind: "days_before_expiry", businessDays: 5 },
          expiry: { kind: "business_days", min: 20, max: 25 },
          strikes: [{ kind: "nearest", price: decimalString("11.00") }],
        },
      ],
    };
    const strategy: StrategyVersion = {
      id: "v1",
      definition,
      structure: coveredCallRollStructure,
    };
    const first = assertDefined(calendar[0], "arbitraries: non-empty calendar");
    const last = assertDefined(calendar.at(-1), "arbitraries: non-empty calendar");
    const config: BacktestConfig = {
      strategy,
      universe: ["PETR4"],
      period: { from: first.date, to: last.date },
      initialCapital: centavos(declaredCapitalReais * 100_00),
      costModel: {
        b3FeeRate: decimalString("0.0005"),
        brokerage: { stockPerOrder: centavos(100), optionPerOrder: centavos(0) },
        optionSlippageRate: decimalString("0.01"),
        incomeTaxRate: decimalString("0.15"),
        monthlyStockSalesExemption: centavos(2_000_000_00),
      },
      riskProfile: {
        declaredCapital: centavos(declaredCapitalReais * 100_00),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
      limits: "enforce",
      sizing: null,
      walkForward: null,
      seed: 1,
    };
    return { config, calendar, candles, optionSeries, optionPrices, nearExpiry, farExpiry };
  });
