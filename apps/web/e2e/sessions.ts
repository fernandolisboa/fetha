import { tradingSessionsForYear } from "../src/modules/market-data/adapters/anbima-calendar/source";

// Fixed past sessions whose real B3 data never changes: the backtest and
// comparison window, and the scoring fixture's decided session and horizon
// (`/api/e2e/seed-decision`).
export const FROM_SESSION = "2026-09-08";
export const TO_SESSION = "2026-09-09";
// The monthly expiry of PETR4 series that traded on FROM_SESSION and
// TO_SESSION: with its own close ingested, `/api/e2e/expired-series` always
// finds an expired series for portfolio.spec.ts.
export const EXPIRY_SESSION = "2026-09-18";

// The signal inbox only takes entries from its newest few closed sessions
// (INBOX_ENTRY_SESSION_HORIZON), so a fixed session ages out of it. The
// second newest closed session stays inside that horizon and B3 has always
// published its COTAHIST file by then, even right after today's close.
// Same pure calendar the app ingests with, so a holiday is never picked.
export function recentSession(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const closed = [...tradingSessionsForYear(year - 1), ...tradingSessionsForYear(year)].filter(
    (session) => new Date(session.close) <= now,
  );
  const session = closed.at(-2);
  if (!session) {
    throw new Error("no closed trading session found in the calendar");
  }
  return session.date;
}

export const REFERENCE_SESSIONS = [FROM_SESSION, TO_SESSION, EXPIRY_SESSION, recentSession()];
