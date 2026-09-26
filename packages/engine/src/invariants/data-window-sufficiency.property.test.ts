import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, IndicatorSpec, LegTemplate, Timeframe } from "@fetha/contracts";
import type { StrategyVersion, TradingSession } from "../api";
import { dataWindow } from "../internal/data-window";
import { instantMs } from "../internal/instant";
import { decimalString } from "../test/support";

// #40: the window dataWindow returns holds at least the candles (and IV points) the strategy's
// indicators need at the anchor, unless the calendar itself is shorter than the lookback, in
// which case the window starts at the calendar's first session. It is also the *tightest* such
// window: no later session-close boundary is itself sufficient, which is what an
// isAtOrBefore/isAfter off-by-one in the session walk-back would break (a mutant of either can
// only ever widen the window, so a one-sided "holds enough" assertion cannot see it).

const minutesOf: Record<Timeframe, number | null> = { "15m": 15, "30m": 30, "60m": 60, D1: null };
const HOUR = 3_600_000;

// Session lengths as short as 15 minutes are drawn on purpose: a session shorter than one bar of
// the 60m (or even 30m) timeframe is exactly the shape that exposes an off-by-one in the session
// walk-back (item 1's reviewer counterexample uses a 30-minute session against a 60m timeframe).
function calendarOf(sessionMinutes: readonly number[]): TradingSession[] {
  return sessionMinutes.map((minutes, i) => {
    const date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    const openMs = new Date(`${date}T13:00:00.000Z`).getTime();
    return {
      date,
      open: `${date}T13:00:00.000Z`,
      close: new Date(openMs + minutes * 60_000).toISOString(),
    };
  });
}

// The last session whose open is at or before the anchor: the one still "in progress" (or just
// closed) as far as the anchor is concerned. Every earlier session is fully in the past.
function anchorSessionIndex(calendar: readonly TradingSession[], anchorMs: number): number {
  let index = -1;
  for (let i = 0; i < calendar.length; i += 1) {
    const session = calendar[i] as TradingSession;
    if (instantMs(session.open) <= anchorMs) index = i;
    else break;
  }
  return index;
}

// A candle's asOf is its close: one per session for D1, one per closed bar intraday. A session
// already in the past (strictly before the anchor session) still yields at least one (partial)
// bar, like data-window.ts's own candlesPerSession, since the backward walk only ever counts
// whole sessions that way. The anchor session itself gets no such floor: like
// data-window.ts's closedInAnchorSession, only the bars that have actually elapsed by the anchor
// count, which can be zero for a session shorter than one bar that has not fully elapsed yet.
function candleCloses(
  calendar: readonly TradingSession[],
  timeframe: Timeframe,
  anchorMs: number,
): number[] {
  const minutes = minutesOf[timeframe];
  const anchorIndex = anchorSessionIndex(calendar, anchorMs);
  return calendar.flatMap((session, i) => {
    const open = instantMs(session.open);
    const close = instantMs(session.close);
    if (minutes === null) return [close];
    const bars =
      i === anchorIndex
        ? Math.max(0, Math.floor((Math.min(anchorMs, close) - open) / (minutes * 60_000)))
        : Math.max(1, Math.floor((close - open) / (minutes * 60_000)));
    return Array.from({ length: bars }, (_, k) =>
      Math.min(open + (k + 1) * minutes * 60_000, close),
    );
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

// Sessions closer to 20 than to 40 keep runtime down while still exceeding the largest lookback
// the specs below can draw (12 * 3 = 36 candles, or 8 IV sessions), so the escape hatch
// (coversWholeCalendar) is reached in only a minority of runs (item 2).
const caseArbitrary = fc
  .record({
    sessionMinutes: fc.array(fc.integer({ min: 15, max: 420 }), { minLength: 20, maxLength: 40 }),
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
    const calendar = calendarOf(drawn.sessionMinutes);
    const session = calendar[drawn.anchorSession % calendar.length] as TradingSession;
    const anchorMs =
      drawn.anchorOffset === "open"
        ? instantMs(session.open)
        : drawn.anchorOffset === "close"
          ? instantMs(session.close)
          : instantMs(session.open) + drawn.anchorOffset * (HOUR / 4);
    return { ...drawn, calendar, anchor: new Date(anchorMs).toISOString() };
  });

// A second implementation of data-window.ts's walk-back, kept in lockstep on purpose: `from` is
// always the first session's open or some session's close, and this recomputes it with the same
// algorithm so that a stray edit to one copy fails against the other. It is not ground truth (a
// bug shared by both copies is invisible, and a legitimate change to computeFrom must be made
// here too); the implementation-independent guarantee is the pair of `>=` assertions below. A
// candle-only oracle was tried and rejected: it cannot express the one-bar minimum a walked-back
// session is credited with, nor the first-session fallback to its open.
function referenceFrom(
  calendar: readonly TradingSession[],
  anchor: string,
  timeframe: Timeframe,
  needed: number,
  ivNeeded: number,
): string {
  const first = calendar[0];
  if (!first) return anchor;
  const anchorMs = instantMs(anchor);
  const minutes = minutesOf[timeframe];

  let anchorIndex = -1;
  for (let i = 0; i < calendar.length; i += 1) {
    if (instantMs((calendar[i] as TradingSession).open) <= anchorMs) anchorIndex = i;
    else break;
  }
  if (anchorIndex === -1) return first.open;

  const bars = (session: TradingSession): number => {
    if (minutes === null) return 1;
    const open = instantMs(session.open);
    const close = instantMs(session.close);
    return Math.max(1, Math.floor((close - open) / (minutes * 60_000)));
  };

  const anchorSession = calendar[anchorIndex] as TradingSession;
  const anchorOpen = instantMs(anchorSession.open);
  const anchorClose = instantMs(anchorSession.close);
  const anchorSessionClosed = anchorClose <= anchorMs;
  const closedInAnchorSession =
    minutes === null
      ? anchorSessionClosed
        ? 1
        : 0
      : Math.min(
          bars(anchorSession),
          Math.max(
            0,
            Math.floor((Math.min(anchorMs, anchorClose) - anchorOpen) / (minutes * 60_000)),
          ),
        );

  let remaining = needed - closedInAnchorSession;
  let sessionsBack = 0;
  while (remaining > 0 && anchorIndex - sessionsBack > 0) {
    sessionsBack += 1;
    remaining -= bars(calendar[anchorIndex - sessionsBack] as TradingSession);
  }

  const candleEarliestIndex = Math.max(0, anchorIndex - sessionsBack);
  const ivEarliestIndex =
    ivNeeded > 0
      ? Math.max(0, anchorIndex - (anchorSessionClosed ? ivNeeded - 1 : ivNeeded))
      : anchorIndex;
  const earliestIndex = Math.min(candleEarliestIndex, ivEarliestIndex);

  return earliestIndex > 0
    ? (calendar[earliestIndex - 1] as TradingSession).close
    : (calendar[earliestIndex] as TradingSession).open;
}

describe("dataWindow sufficiency (#40)", () => {
  it("covers every candle and IV point the indicators need at the anchor, or the whole calendar, at the tightest such boundary", () => {
    let nonVacuousRuns = 0;
    let totalRuns = 0;
    fc.assert(
      fc.property(caseArbitrary, ({ calendar, timeframe, specs, anchor }) => {
        totalRuns += 1;
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
        if (!coversWholeCalendar) nonVacuousRuns += 1;

        const candles = candleCloses(calendar, timeframe, anchorMs).filter(
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

        // Tightness (item 1): `from` must be the reference oracle's tightest boundary, not any
        // wider one. A widening bug (e.g. an off-by-one in the session walk-back) still passes
        // the two assertions above, since it only ever adds candles/IV points, but fails this one.
        expect(window.from).toBe(referenceFrom(calendar, anchor, timeframe, needed, ivNeeded));
      }),
      { numRuns: 500 },
    );

    expect(totalRuns).toBeGreaterThan(0);
    expect(nonVacuousRuns / totalRuns).toBeGreaterThan(0.5);
  });

  it("returns the same window for a calendar with a duplicated date as for the earliest-opening row of that date (ADR-0013 #40)", () => {
    fc.assert(
      fc.property(
        caseArbitrary,
        fc.nat(),
        fc.integer({ min: -2, max: 2 }),
        ({ calendar, timeframe, specs, anchor }, pick, hourShift) => {
          const original = calendar[pick % calendar.length] as TradingSession;
          const originalOpenMs = instantMs(original.open);
          const shiftedOpenMs = originalOpenMs + hourShift * HOUR;
          const laterOpening = shiftedOpenMs > originalOpenMs;
          const duplicate: TradingSession = {
            date: original.date,
            open: new Date(shiftedOpenMs).toISOString(),
            close: original.close,
          };
          const input = {
            strategy: strategyReading(specs, timeframe),
            instruments: ["PETR4"],
            at: anchor,
          };
          const withDuplicate = dataWindow({ ...input, calendar: [...calendar, duplicate] });
          const earliestOpeningRow = laterOpening ? original : duplicate;
          const deduplicated = calendar.map((session) =>
            session === original ? earliestOpeningRow : session,
          );
          expect(withDuplicate).toEqual(dataWindow({ ...input, calendar: deduplicated }));
        },
      ),
    );
  });
});
