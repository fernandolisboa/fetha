import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, IndicatorSpec } from "@fetha/contracts";
import type { Candle, MarketView, Signal, StrategyVersion, TradingSession } from "../api";
import { dataWindow } from "../internal/data-window";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { assertDefined } from "../internal/invariant";
import { centavos, decimalString } from "../test/support";
import { ohlcArbitrary } from "./arbitraries";

// #239: a recursive indicator's reading at an instant depends only on the fixed trailing window
// the evaluator reads for it (3 * length candles for EMA, 6 * length for RSI and ATR, ending
// there), never on how much older history the view happens to hold, so a one-night run and a
// catch-up evaluating the same session agree.

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

const specs: [IndicatorSpec, ...IndicatorSpec[]] = [
  { kind: "ema", length: 2 },
  { kind: "rsi", length: 3 },
  { kind: "atr", length: 2 },
];
const LONGEST_WINDOW = 18;

const alwaysHolds = (indicator: IndicatorSpec): Condition => ({
  kind: "or",
  conditions: [
    {
      kind: "compare",
      left: { kind: "indicator", indicator },
      comparator: ">=",
      right: { kind: "constant", value: decimalString("0") },
    },
    {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    },
  ],
});

const strategy: StrategyVersion = {
  id: "v1",
  definition: {
    name: "test",
    timeframe: "D1",
    entry: {
      kind: "and",
      conditions: [alwaysHolds(specs[0]), ...specs.slice(1).map(alwaysHolds)],
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
    exit: [],
    adjustments: [],
  },
  structure: {
    id: "stock",
    name: "Stock",
    expiry: "shared",
    legs: [{ role: "stock", side: "buy", ratio: 1 }],
  },
};

const sessionAt = (index: number): string =>
  new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);

const seriesArbitrary = fc
  .array(ohlcArbitrary, { minLength: LONGEST_WINDOW, maxLength: 40 })
  .map((ohlcs) =>
    ohlcs.map((ohlc, i): Candle => {
      const session = sessionAt(i);
      return {
        ticker: "PETR4",
        timeframe: "D1",
        session,
        asOf: `${session}T21:00:00.000Z`,
        ...ohlc,
        tradedQuantity: 1000,
      };
    }),
  );

const smaStrategy: StrategyVersion = {
  ...strategy,
  definition: {
    ...strategy.definition,
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 4 } },
    },
  },
};

function evaluateAt(
  candles: readonly Candle[],
  calendar: readonly TradingSession[],
  at: string,
  since?: string,
  version: StrategyVersion = strategy,
): unknown {
  const result = evaluateStrategy({
    view: { ...emptyView, candles: [...candles], calendar: [...calendar] },
    strategy: version,
    instruments: ["PETR4"],
    at,
    ...(since === undefined ? {} : { since }),
    riskProfile: {
      declaredCapital: centavos(1_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 100,
        maxPremiumBought: decimalString("1"),
      },
    },
  });
  if (!result.ok) throw new Error("test setup: unexpected engine error");
  return { signals: result.value.signals, evaluations: result.value.evaluations };
}

function evaluateAtLastClose(candles: readonly Candle[]): unknown {
  return evaluateAt(
    candles,
    [],
    assertDefined(candles.at(-1), "test setup: missing last candle").asOf,
  );
}

describe("Recursive indicator warm-up invariance (#239)", () => {
  it("reads EMA, RSI and ATR at an instant the same whatever history precedes their trailing window", () => {
    let sawSignal = false;
    fc.assert(
      fc.property(seriesArbitrary, fc.nat(), (candles, drop) => {
        const trimmed = candles.slice(drop % (candles.length - LONGEST_WINDOW + 1));
        const full = evaluateAtLastClose(candles);
        expect(evaluateAtLastClose(trimmed)).toEqual(full);
        if ((full as { signals: Signal[] }).signals.length > 0) sawSignal = true;
      }),
    );
    expect(sawSignal).toBe(true);
  });

  // With a calendar the window counts sessions, so a session without a candle (a halt, an
  // illiquid day), the newest one included, must not pull an older candle into the full view that
  // dataWindow's view lacks: neither in a one-night call nor in a catch-up.
  it("reads them the same in dataWindow's view as over the whole history, sessions without a candle included", () => {
    let sawSignal = false;
    fc.assert(
      fc.property(
        seriesArbitrary,
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
        (series, missing, catchUp) => {
          const calendar = series.map((candle) => ({
            date: candle.session,
            open: `${candle.session}T13:00:00.000Z`,
            close: candle.asOf,
          }));
          const candles = series.filter((_, i) => i === 0 || !missing[i]);
          const at = assertDefined(calendar.at(-1), "test setup: missing last session").close;
          const since =
            catchUp === undefined
              ? undefined
              : assertDefined(calendar.at(-1 - catchUp), "test setup: missing session").close;
          const { from } = dataWindow({
            strategy,
            instruments: ["PETR4"],
            calendar,
            at,
            ...(since === undefined ? {} : { since }),
          });
          const full = evaluateAt(candles, calendar, at, since);
          expect(
            evaluateAt(
              candles.filter((candle) => candle.asOf > from),
              calendar.filter((session) => session.close >= from),
              at,
              since,
            ),
          ).toEqual(full);
          if ((full as { signals: Signal[] }).signals.length > 0) sawSignal = true;
        },
      ),
    );
    expect(sawSignal).toBe(true);
  });

  // #250: an SMA reads its last `length` candles only when they all fall inside the window of
  // `length` sessions dataWindow requests, so a session without a candle cannot make a catch-up
  // (whose view starts earlier) read a number where the one-night view reads none.
  it("reads the SMA the same in dataWindow's view as over the whole history, sessions without a candle included", () => {
    let sawSignal = false;
    let sawGap = false;
    fc.assert(
      fc.property(
        seriesArbitrary,
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
        (series, missing, catchUp) => {
          const calendar = series.map((candle) => ({
            date: candle.session,
            open: `${candle.session}T13:00:00.000Z`,
            close: candle.asOf,
          }));
          // The last session keeps its candle: a ticker halted on `at`'s own session is ADR-0048's
          // exception (a window ending at `at`), pinned by its own unit test (#250).
          const candles = series.filter(
            (_, i) => i === 0 || i === series.length - 1 || !missing[i],
          );
          const at = assertDefined(calendar.at(-1), "test setup: missing last session").close;
          const since =
            catchUp === undefined
              ? undefined
              : assertDefined(calendar.at(-1 - catchUp), "test setup: missing session").close;
          const { from } = dataWindow({
            strategy: smaStrategy,
            instruments: ["PETR4"],
            calendar,
            at,
            ...(since === undefined ? {} : { since }),
          });
          const full = evaluateAt(candles, calendar, at, since, smaStrategy);
          expect(
            evaluateAt(
              candles.filter((candle) => candle.asOf > from),
              calendar.filter((session) => session.close >= from),
              at,
              since,
              smaStrategy,
            ),
          ).toEqual(full);
          if ((full as { signals: Signal[] }).signals.length > 0) sawSignal = true;
          if (candles.length < series.length) sawGap = true;
        },
      ),
    );
    expect(sawSignal).toBe(true);
    expect(sawGap).toBe(true);
  });
});
