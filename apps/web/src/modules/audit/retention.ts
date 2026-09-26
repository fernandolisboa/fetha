import { lt } from "drizzle-orm";

import type { Database } from "@/db/client";

import { accessLog } from "./schema";

export const ACCESS_LOG_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessLogPurgeOutcome = { ok: true; deleted: number } | { ok: false };

// A system job over every user, run by the nightly cron (docs/adr/0027), so
// a user who stops signing in still has their old entries removed.
export async function purgeExpiredAccessLog(
  db: Database,
  now: Date = new Date(),
): Promise<AccessLogPurgeOutcome> {
  const cutoff = new Date(now.getTime() - ACCESS_LOG_RETENTION_DAYS * DAY_MS);
  try {
    const deleted = await db
      .delete(accessLog)
      .where(lt(accessLog.occurredAt, cutoff))
      .returning({ id: accessLog.id });
    return { ok: true, deleted: deleted.length };
  } catch (error) {
    console.error("access log purge failed", error instanceof Error ? error.name : "Unknown");
    return { ok: false };
  }
}
