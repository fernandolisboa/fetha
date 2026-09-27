import { lt } from "drizzle-orm";

import type { Database } from "@/db/client";

import { session } from "./schema";

export const SESSION_EXPIRES_IN_DAYS = 7;

export type ExpiredSessionPurgeOutcome = { ok: true; deleted: number } | { ok: false };

// Better Auth deletes an expired session only when its cookie comes back, so
// one abandoned in another browser would keep its IP address and user agent
// for as long as the account exists (#146, LGPD art. 6, III). A system job
// over every user, run by the nightly cron.
export async function purgeExpiredSessions(
  db: Database,
  now: Date = new Date(),
): Promise<ExpiredSessionPurgeOutcome> {
  try {
    const deleted = await db
      .delete(session)
      .where(lt(session.expiresAt, now))
      .returning({ id: session.id });
    return { ok: true, deleted: deleted.length };
  } catch (error) {
    console.error("expired session purge failed", error instanceof Error ? error.name : "Unknown");
    return { ok: false };
  }
}
