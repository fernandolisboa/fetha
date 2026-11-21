import type { SessionDate } from "@fetha/contracts";
import type { TradingSession } from "@fetha/engine";

import { PLAN_MAX_SESSIONS_AHEAD, PLAN_MIN_SESSIONS_AHEAD } from "./plan-selection";

// How many trading sessions separate the anchor session from a given expiry, read off the
// market view's own calendar (never a second DB round trip) — mirrors the engine's own
// `business_days` window resolution (`resolve-leg-selection.ts`): a session's index in the
// calendar minus the anchor's own index. Null when either date is not a listed session, or the
// expiry is not strictly after the anchor. The market view's own calendar is always built in
// session order (`market-data`'s own ingestion), but this sorts its own copy by date first
// rather than trusting that — an index comparison is only meaningful once it holds.
export function sessionsAhead(
  calendar: readonly TradingSession[],
  anchor: SessionDate,
  expiry: SessionDate,
): number | null {
  const sorted = [...calendar].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const anchorIndex = sorted.findIndex((session) => session.date === anchor);
  const expiryIndex = sorted.findIndex((session) => session.date === expiry);
  if (anchorIndex === -1 || expiryIndex === -1) return null;
  const sessionsAheadCount = expiryIndex - anchorIndex;
  return sessionsAheadCount > 0 ? sessionsAheadCount : null;
}

// The plan's own series rule (`plan-selection.ts`, ticket #379): an expiry chip or a drag-to-
// adjust edit may only ever name an expiry inside this same window, server-checked (ticket
// #380, item 7) rather than trusted from the chips a client happened to render.
export function isWithinPlanWindow(
  calendar: readonly TradingSession[],
  anchor: SessionDate,
  expiry: SessionDate,
): boolean {
  const ahead = sessionsAhead(calendar, anchor, expiry);
  return ahead !== null && ahead >= PLAN_MIN_SESSIONS_AHEAD && ahead <= PLAN_MAX_SESSIONS_AHEAD;
}
