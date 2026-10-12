import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

// Fixed past sessions whose real B3 data never changes: the backtest and
// comparison window, and the scoring fixture's decided session and horizon
// (`/api/e2e/seed-decision`).
export const FROM_SESSION = "2026-09-08";
export const TO_SESSION = "2026-09-09";
// The monthly expiry of PETR4 series that traded on FROM_SESSION and
// TO_SESSION: with its own close ingested, `/api/e2e/expired-series` always
// finds an expired series for portfolio.spec.ts.
export const EXPIRY_SESSION = "2026-09-18";

export const FIXED_SESSIONS = [FROM_SESSION, TO_SESSION, EXPIRY_SESSION];

// A session inside the signal inbox's horizon, from the app's own ingested
// calendar (`/api/e2e/recent-session`), so it is never a holiday.
export async function recentSession(request: APIRequestContext, secret: string): Promise<string> {
  const response = await request.get("/api/e2e/recent-session", {
    headers: { "x-e2e-secret": secret },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { session: string }).session;
}
