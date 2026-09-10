import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { strategies } from "@/db/schema/strategies";

// The nightly evaluation's loop driver (#19): the ids of every user with at
// least one active strategy, nothing else about their strategies. Every
// per-user read after this goes through StrategiesRepository, WatchlistRepository
// and SignalsRepository constructed with that id (CLAUDE.md principle 5: no
// method on a user-scoped repository accepts a user id parameter — this
// function is not one, it drives the loop that constructs them). Whether a
// strategy is daily is checked once the caller has the user's own
// StrategiesRepository, not here, so this function never reads strategy
// content across tenants.
export async function activeStrategyUserIds(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: strategies.userId })
    .from(strategies)
    .where(eq(strategies.active, true));
  return rows.map((row) => row.userId);
}
