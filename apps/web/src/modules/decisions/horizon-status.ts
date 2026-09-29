import type { SessionDate } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { tradingSessionForDate } from "@/modules/market-data";

export type HorizonStatus = "open" | "in_past" | "session_closed";

// A horizon of "today" is only open while today's own session is: once it
// closes (or today is not a trading session at all: a weekend, a holiday),
// a claim on "today's close" would score a close that happened before the
// decision was recorded. The `decisions_horizon_on_or_after_decided_check`
// constraint compares dates only, so this is the only guard for that case.
// One checker reads today's session at most once, however many horizons it
// is asked about.
export function horizonChecker(
  db: Database,
  now: Date,
): (horizon: SessionDate) => Promise<HorizonStatus> {
  const today = todaySaoPauloDate(now);
  let todayStillOpen: Promise<boolean> | undefined;
  return async (horizon) => {
    if (horizon < today) {
      return "in_past";
    }
    if (horizon > today) {
      return "open";
    }
    todayStillOpen ??= tradingSessionForDate(db, today).then(
      (session) => session !== undefined && session.close > now.toISOString(),
    );
    return (await todayStillOpen) ? "open" : "session_closed";
  };
}
