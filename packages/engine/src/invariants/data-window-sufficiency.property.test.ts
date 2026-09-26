import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, IndicatorSpec, LegTemplate, Timeframe } from "@fetha/contracts";
import type { StrategyVersion, TradingSession } from "../api";
import { dataWindow } from "../internal/data-window";
import { instantMs } from "../internal/instant";
import { decimalString } from "../test/support";

// #40: the window dataWindow returns holds at least the candles (and IV points) the strategy's
// indicators need at the anchor, unless the calendar itself is shorter than the lookback, in
// which case the window starts at the calendar's first session.

const minutesOf: Record<Timeframe, number | null> = { "15m": 15, "30m": 30, "60m": 60, D1: null };
const HOUR = 3_600_000;

function calendarOf(earlyCloses: readonly boolean[]): TradingSession[] {
  return earlyCloses.map((early, i) => {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      date,
      open: `${date}T13:00:00.000Z`,
      close: early ? `${date}T17:00:00.000Z` : `${date}T20:00:00.000Z`,
    };
  });
}

// A candle's asOf is its close: one per session for D1, one per closed bar intraday.
function candleCloses(calendar: readonly TradingSession[], timeframe: Timeframe): number[] {
  const minutes = minutesOf[timeframe];
  return calendar.flatMap((session) => {
    const open = instantMs(session.open);
    const close = instantMs(session.close);
    if (minutes === null) return [close];
    const bars = Math.max(1, Math.floor((close - open) / (minutes * 60_000)));
    return Array.from({ length: bars }, (_, k) => open + (k + 1) * minutes * 60_000);
  });
}

function candlesNeeded(spec: IndicatorSpec): number {
  switch (spec.kind) {
    case "sma":
      return spec.length;
    case "ema":
    case "rsi":
    case "atr":
      return spec.length * 3;
    case "iv_rank":
      return 1;
  }
}

const specArbitrary: fc.Arbitrary<IndicatorSpec> = fc.oneof(
  fc.record({
    kind: fc.constantFrom("sma" as const, "ema" as const, "rsi" as const, "atr" as const),
    length: fc.integer({ min: 1, max: 12 }),
  }),
  fc.record({
    kind: fc.constant("iv_rank" as const),
    lookbackSessions: fc.integer({ min: 2, max: 8 }),
  }),
);

function strategyReading(specs: readonly IndicatorSpec[], timeframe: Timeframe): StrategyVersion {
  const conditions = specs.map((indicator): Condition => ({
    kind: "compare",
    left: { kind: "indicator", indicator },
    comparator: ">",
    right: { kind: "constant", value: decimalString("0") },
  })) as [Condition, ...Condition[]];
  return {
    id: "v1",
    definition: {
      name: "window",
      timeframe,
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
      entry: { kind: "and", conditions },
      exit: [],
      adjustments: [],
    },
    structure: {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
    },
  };
}

const caseArbitrary = fc
  .record({
    earlyCloses: fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
    timeframe: fc.constantFrom<Timeframe>("D1", "15m", "30m", "60m"),
    specs: fc.array(specArbitrary, { minLength: 1, maxLength: 3 }),
    // An anchor on a session boundary (its open or close) or at any quarter hour within it.
    anchorSession: fc.nat(),
    anchorOffset: fc.oneof(
      fc.constantFrom("open" as const, "close" as const),
      fc.integer({ min: -4, max: 40 }),
    ),
  })
  .map((drawn) => {
    const calendar = calendarOf(drawn.earlyCloses);
    const session = calendar[drawn.anchorSession % calendar.length] as TradingSession;
    const anchorMs =
      drawn.anchorOffset === "open"
        ? instantMs(session.open)
        : drawn.anchorOffset === "close"
          ? instantMs(session.close)
          : instantMs(session.open) + drawn.anchorOffset * (HOUR / 4);
    return { ...drawn, calendar, anchor: new Date(anchorMs).toISOString() };
  });

describe("dataWindow sufficiency (#40)", () => {
  it("covers every candle and IV point the indicators need at the anchor, or the whole calendar", () => {
    fc.assert(
      fc.property(caseArbitrary, ({ calendar, timeframe, specs, anchor }) => {
        const window = dataWindow({
          strategy: strategyReading(specs, timeframe),
          instruments: ["PETR4"],
          calendar,
          at: anchor,
        });
        const fromMs = instantMs(window.from);
        const anchorMs = instantMs(anchor);
        const first = calendar[0] as TradingSession;
        const coversWholeCalendar = fromMs <= instantMs(first.open);

        const candles = candleCloses(calendar, timeframe).filter(
          (close) => close > fromMs && close <= anchorMs,
        ).length;
        const needed = Math.max(1, ...specs.map(candlesNeeded));
        expect(candles >= needed || coversWholeCalendar).toBe(true);

        const ivPoints = calendar.filter((session) => {
          const close = instantMs(session.close);
          return close > fromMs && close <= anchorMs;
        }).length;
        const ivNeeded = Math.max(
          0,
          ...specs.map((spec) => (spec.kind === "iv_rank" ? spec.lookbackSessions : 0)),
        );
        expect(ivPoints >= ivNeeded || coversWholeCalendar).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("returns the same window for a calendar with a duplicated session as for the deduplicated one", () => {
    fc.assert(
      fc.property(caseArbitrary, fc.nat(), ({ calendar, timeframe, specs, anchor }, pick) => {
        const duplicated = calendar[pick % calendar.length] as TradingSession;
        const input = {
          strategy: strategyReading(specs, timeframe),
          instruments: ["PETR4"],
          at: anchor,
        };
        expect(dataWindow({ ...input, calendar: [...calendar, { ...duplicated }] })).toEqual(
          dataWindow({ ...input, calendar }),
        );
      }),
    );
  });
});
