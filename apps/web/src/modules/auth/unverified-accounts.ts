import { and, eq, inArray, lt, type SQL } from "drizzle-orm";

import type { Database } from "@/db/client";

import { normalizeEmail } from "./normalize-email";
import { account, session, user, verification } from "./schema";

export const UNVERIFIED_ACCOUNT_RETENTION_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

export type UnverifiedAccountPurgeOutcome = { ok: true; deleted: number } | { ok: false };

// Nobody has proven they own the mailbox of an unverified account, so
// nothing tied to it (a password, a session) may outlive the proof
// (docs/adr/0016, #144). Mirrors Better Auth's own `revokeUnprovenAccountAccess`,
// which only the magic-link path runs.
export async function revokeUnprovenAccess(db: Database, userId: string): Promise<void> {
  await db.delete(account).where(eq(account.userId, userId));
  await db.delete(session).where(eq(session.userId, userId));
}

// A completed password reset proves the mailbox as much as the verification
// link does, and the password it sets is the owner's.
export async function markEmailVerified(db: Database, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(and(eq(user.id, userId), eq(user.emailVerified, false)));
}

// An unverified account never had a session, so it owns no domain data; the
// cascade from `user` removes its terms history, and pending reset tokens
// carry its id as their value.
async function deleteUnverifiedUsers(db: Database, where: SQL | undefined): Promise<number> {
  const deleted = await db
    .delete(user)
    .where(and(eq(user.emailVerified, false), where))
    .returning({ id: user.id });
  const ids = deleted.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(verification).where(inArray(verification.value, ids));
  }
  return ids.length;
}

// The latest sign-up for a still-unverified email replaces the pending one,
// so its name and consent are the ones kept and its owner gets the email.
export async function discardUnverifiedAccount(db: Database, email: string): Promise<void> {
  await deleteUnverifiedUsers(db, eq(user.email, normalizeEmail(email)));
}

// A system job over every account, run by the nightly cron.
export async function purgeUnverifiedAccounts(
  db: Database,
  now: Date = new Date(),
): Promise<UnverifiedAccountPurgeOutcome> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_RETENTION_HOURS * HOUR_MS);
  try {
    const deleted = await deleteUnverifiedUsers(db, lt(user.createdAt, cutoff));
    return { ok: true, deleted };
  } catch (error) {
    console.error(
      "unverified account purge failed",
      error instanceof Error ? error.name : "Unknown",
    );
    return { ok: false };
  }
}
