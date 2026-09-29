import type { Instant, SessionDate, Timeframe } from "@fetha/contracts";
import type { DataWindow, DataWindowInput, MarketViewCollection, TradingSession } from "../api";
import { collectIndicatorSpecs } from "./collect-indicator-specs";
import { warmUpCandleCount } from "./indicator-warm-up";
import { compareInstants, instantMs, isAtOrBefore } from "./instant";
import { assertDefined } from "./invariant";
import { codeUnitCompare } from "./order";
import { upperBound } from "./search";

const timeframeMinutes: Record<Timeframe, number | null> = {
  "15m": 15,
  "30m": 30,
  "60m": 60,
  D1: null,
};

export function dataWindow(input: DataWindowInput): DataWindow {
  const { strategy, instruments, calendar, at, since } = input;
  const sortedCalendar = tradingCalendar(calendar);

  const indicators = collectIndicatorSpecs(strategy.definition);
  const candlesNeeded = Math.max(1, ...indicators.map(warmUpCandleCount));
  const ivSessionsNeeded = Math.max(
    0,
    ...indicators.filter((i) => i.kind === "iv_rank").map((i) => i.lookbackSessions),
  );

  const anchor = since ?? at;
  const anchorIndex = sessionIndexAtOrBefore(sortedCalendar, anchor);
  const firstSession = sortedCalendar.sessions[0];

  const from =
    anchorIndex === null
      ? (firstSession?.open ?? at)
      : computeFrom(
          sortedCalendar.sessions,
          anchorIndex,
          candlesNeeded,
          ivSessionsNeeded,
          strategy.definition.timeframe,
          anchor,
        );

  const hasOptionLegs = strategy.structure.legs.some((leg) => leg.role !== "stock");
  const collections: MarketViewCollection[] = [
    "candles",
    "corporateActions",
    "macro",
    "dividendYields",
  ];
  if (ivSessionsNeeded > 0) collections.push("impliedVolatilityIndex");
  if (hasOptionLegs) collections.push("optionSeries", "optionPrices");

  return {
    from,
    to: at,
    instruments,
    timeframes: [strategy.definition.timeframe],
    collections,
  };
}

export type TradingCalendar = {
  sessions: readonly TradingSession[];
  leadingOpenMs: readonly number[];
};

const tradingCalendars = new WeakMap<readonly TradingSession[], TradingCalendar>();

// One session per date (#40): a duplicated date would be walked twice and shorten the window.
// dataWindow never fails, so it keeps the earliest-opening row of a date; every method that
// computes over the view rejects the duplicate itself. Memoized per calendar array: the evaluator
// walks it once per recursive reading (ADR-0048).
export function tradingCalendar(calendar: readonly TradingSession[]): TradingCalendar {
  const cached = tradingCalendars.get(calendar);
  if (cached) return cached;
  const sessions = [...calendar]
    .sort(
      (a, b) =>
        codeUnitCompare(a.date, b.date) ||
        compareInstants(a.open, b.open) ||
        compareInstants(a.close, b.close),
    )
    .filter((session, i, sorted) => sorted[i - 1]?.date !== session.date);
  let highest = -Infinity;
  const leadingOpenMs = sessions.map((session) => {
    highest = Math.max(highest, instantMs(session.open));
    return highest;
  });
  const result = { sessions, leadingOpenMs };
  tradingCalendars.set(calendar, result);
  return result;
}

// The last of the leading sessions (in date order) that open at or before `instant`: the walk
// stops at the first session opening after it, so the running maximum of the opens is the
// ascending key.
function sessionIndexAtOrBefore(calendar: TradingCalendar, instant: Instant): number | null {
  const count = upperBound(calendar.leadingOpenMs, instantMs(instant));
  return count === 0 ? null : count - 1;
}

// The first session whose candles a window of `candlesNeeded` candles ending at `anchor` reads,
// walked over calendar sessions exactly as dataWindow walks them: a view dataWindow built for any
// earlier anchor holds every candle from it on. Null when no session opens at or before `anchor`.
export function earliestCandleSession(
  calendar: TradingCalendar,
  anchor: Instant,
  candlesNeeded: number,
  timeframe: Timeframe,
): SessionDate | null {
  const anchorIndex = sessionIndexAtOrBefore(calendar, anchor);
  if (anchorIndex === null) return null;
  const { index } = earliestCandleIndex(
    calendar.sessions,
    anchorIndex,
    candlesNeeded,
    timeframe,
    anchor,
  );
  return assertDefined(calendar.sessions[index], "dataWindow: missing earliest session").date;
}

function candlesPerSession(session: TradingSession, minutes: number | null): number {
  if (minutes === null) return 1;
  return Math.max(
    1,
    Math.floor((instantMs(session.close) - instantMs(session.open)) / (minutes * 60_000)),
  );
}

function earliestCandleIndex(
  calendar: readonly TradingSession[],
  anchorIndex: number,
  candlesNeeded: number,
  timeframe: Timeframe,
  anchor: Instant,
): { index: number; anchorSessionClosed: boolean } {
  const minutes = timeframeMinutes[timeframe];
  const anchorSession = assertDefined(calendar[anchorIndex], "dataWindow: missing anchor session");

  const anchorSessionClosed = isAtOrBefore(anchorSession.close, anchor);
  const closedInAnchorSession =
    minutes === null
      ? anchorSessionClosed
        ? 1
        : 0
      : Math.min(
          candlesPerSession(anchorSession, minutes),
          Math.max(
            0,
            Math.floor(
              (Math.min(instantMs(anchor), instantMs(anchorSession.close)) -
                instantMs(anchorSession.open)) /
                (minutes * 60_000),
            ),
          ),
        );

  let remaining = candlesNeeded - closedInAnchorSession;
  let sessionsBack = 0;
  while (remaining > 0 && anchorIndex - sessionsBack > 0) {
    sessionsBack += 1;
    const session = assertDefined(
      calendar[anchorIndex - sessionsBack],
      "dataWindow: missing prior session",
    );
    remaining -= candlesPerSession(session, minutes);
  }

  return { index: Math.max(0, anchorIndex - sessionsBack), anchorSessionClosed };
}

function computeFrom(
  calendar: readonly TradingSession[],
  anchorIndex: number,
  candlesNeeded: number,
  ivSessionsNeeded: number,
  timeframe: Timeframe,
  anchor: Instant,
): Instant {
  const { index: candleEarliestIndex, anchorSessionClosed } = earliestCandleIndex(
    calendar,
    anchorIndex,
    candlesNeeded,
    timeframe,
    anchor,
  );
  const ivEarliestIndex =
    ivSessionsNeeded > 0
      ? Math.max(0, anchorIndex - (anchorSessionClosed ? ivSessionsNeeded - 1 : ivSessionsNeeded))
      : anchorIndex;
  const earliestIndex = Math.min(candleEarliestIndex, ivEarliestIndex);

  const boundarySession = assertDefined(
    calendar[earliestIndex],
    "dataWindow: missing earliest needed session",
  );
  return earliestIndex > 0
    ? assertDefined(
        calendar[earliestIndex - 1],
        "dataWindow: missing session preceding the earliest needed session",
      ).close
    : boundarySession.open;
}
