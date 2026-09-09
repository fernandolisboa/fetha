import type { Database } from "@/db/client";

import { latestSessionOnOrBefore } from "./repositories/calendar-repository";

// "The last trading session not yet ingested" (#12): the cron's target is
// always the most recent closed session on the calendar; whether it still
// needs ingesting per source is decided per source inside ingest.ts (a
// succeeded run for that session already recorded means skip, the no-op that
// makes a retry safe).
export async function targetSession(db: Database, at: Date = new Date()): Promise<string | null> {
  const session = await latestSessionOnOrBefore(db, at);
  return session?.date ?? null;
}
