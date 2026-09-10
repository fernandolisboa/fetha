import type { Instant } from "@fetha/contracts";
import type { TradingSession } from "../api";
import { compareInstants, isAtOrBefore } from "./instant";

export const SESSIONS_PER_YEAR = 252;

export function sortedCalendar(calendar: readonly TradingSession[]): TradingSession[] {
  return [...calendar].sort((a, b) => compareInstants(a.open, b.open));
}

// Shared by every module that needs "the session `at` falls in" from an unsorted
// calendar: resolve-leg-selection.ts, price-operation.ts, implied-volatility-index.ts and
// time-to-expiry.ts all had their own copy (PR #53 round 3 item 9).
export function sessionAtOrBefore(
  calendar: readonly TradingSession[],
  at: Instant,
): TradingSession | null {
  let found: TradingSession | null = null;
  for (const session of sortedCalendar(calendar)) {
    if (isAtOrBefore(session.open, at)) found = session;
  }
  return found;
}
