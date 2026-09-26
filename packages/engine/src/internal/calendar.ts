import type { Instant, SessionDate } from "@fetha/contracts";
import type { TradingSession } from "../api";
import { instantMs } from "./instant";
import { upperBound } from "./search";

export const SESSIONS_PER_YEAR = 252;

type CalendarIndex = { sorted: readonly TradingSession[]; openMs: readonly number[] };

// Memoized per calendar array, like view-index.ts (#58): every pricing call and every session of
// a backtest used to re-sort the whole calendar.
const calendarIndexes = new WeakMap<readonly TradingSession[], CalendarIndex>();

function calendarIndex(calendar: readonly TradingSession[]): CalendarIndex {
  const cached = calendarIndexes.get(calendar);
  if (cached) return cached;
  const entries = calendar
    .map((session) => ({ session, openMs: instantMs(session.open) }))
    .sort((a, b) => a.openMs - b.openMs);
  const index = {
    sorted: entries.map((e) => e.session),
    openMs: entries.map((e) => e.openMs),
  };
  calendarIndexes.set(calendar, index);
  return index;
}

export function sortedCalendar(calendar: readonly TradingSession[]): readonly TradingSession[] {
  return calendarIndex(calendar).sorted;
}

// Shared by every module that needs "the session `at` falls in" from an unsorted
// calendar: resolve-leg-selection.ts, price-operation.ts, implied-volatility-index.ts and
// time-to-expiry.ts all had their own copy (PR #53 round 3 item 9).
export function sessionAtOrBefore(
  calendar: readonly TradingSession[],
  at: Instant,
): TradingSession | null {
  const { sorted, openMs } = calendarIndex(calendar);
  return sorted[upperBound(openMs, instantMs(at)) - 1] ?? null;
}

// proposeSettlement's truncation instant is the expiry session's own close, which the
// caller supplies only as a SessionDate (ADR-0013 #25 addendum): the exact session, not the
// last one at or before an instant.
export function sessionByDate(
  calendar: readonly TradingSession[],
  date: SessionDate,
): TradingSession | null {
  return calendar.find((session) => session.date === date) ?? null;
}
