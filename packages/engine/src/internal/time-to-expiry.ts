import type { Instant, SessionDate } from "@fetha/contracts";
import type { TradingSession } from "../api";
import { compareInstants, isAtOrBefore } from "./instant";

export type TimeToExpiryResult = { ok: true; years: number } | { ok: false };

const SESSIONS_PER_YEAR = 252;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ADR-0013 "Rates, time and greeks": time to expiry in years is (n + (1 - f)) / 252, where
// n is the number of sessions strictly after the session containing `at` up to and including
// the expiry session, and f is the fraction of that session elapsed at `at`.
export function resolveTimeToExpiryYears(
  calendar: readonly TradingSession[],
  at: Instant,
  expiry: SessionDate,
): TimeToExpiryResult {
  const sorted = [...calendar].sort((a, b) => compareInstants(a.open, b.open));

  let atSession: TradingSession | null = null;
  for (const session of sorted) {
    if (isAtOrBefore(session.open, at)) atSession = session;
  }
  if (!atSession) return { ok: false };

  const expirySession = sorted.find((session) => session.date === expiry);
  if (!expirySession) return { ok: false };

  const atIndex = sorted.indexOf(atSession);
  const expiryIndex = sorted.indexOf(expirySession);
  if (expiryIndex < atIndex) return { ok: false };

  const n = expiryIndex - atIndex;
  const span = compareInstants(atSession.close, atSession.open);
  const elapsed = span === 0 ? 1 : compareInstants(at, atSession.open) / span;
  const f = clamp01(elapsed);

  return { ok: true, years: (n + (1 - f)) / SESSIONS_PER_YEAR };
}
