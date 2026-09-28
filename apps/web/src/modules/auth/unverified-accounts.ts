import { and, eq, inArray, lt } from "drizzle-orm";

import type { Database } from "@/db/client";

import { account, user, verification } from "./schema";

export const UNVERIFIED_ACCOUNT_RETENTION_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

export type UnverifiedAccountPurgeOutcome = { ok: true; deleted: number } | { ok: false };

// Nobody has proven they own the mailbox of an unverified account, so no
// password linked to it may outlive the proof (docs/adr/0028, #144). Mirrors
// Better Auth's own `revokeUnprovenAccountAccess`, which only the magic-link
// path runs, minus the sessions: an unverified account cannot hold one, and
// the only session that can exist here is the one a concurrent open of the
// same link just minted for the mailbox owner.
export async function revokeUnprovenAccountAccess(db: Database, userId: string): Promise<void> {
  await db.delete(account).where(eq(account.userId, userId));
}

// A completed password reset proves the mailbox as much as the verification
// link does, and the password it sets is the owner's. The consent stamped at
// sign-up was given before that proof (docs/adr/0028's residual, closed by
// docs/adr/0036), so it is cleared here in the same UPDATE: the mailbox
// owner accepts the current terms themselves through /aceitar-termos. The
// `emailVerified: false` guard keeps this a one-time effect of the
// unverified->verified flip, never re-running on an already-verified row.
export async function markEmailVerified(db: Database, userId: string): Promise<void> {
  await db
    .update(user)
    .set({ emailVerified: true, termsVersion: null, termsAcceptedAt: null })
    .where(and(eq(user.id, userId), eq(user.emailVerified, false)));
}

// A system job over every account, run by the nightly cron.
export async function purgeUnverifiedAccounts(
  db: Database,
  now: Date = new Date(),
): Promise<UnverifiedAccountPurgeOutcome> {
  const cutoff = new Date(now.getTime() - UNVERIFIED_ACCOUNT_RETENTION_HOURS * HOUR_MS);
  try {
    // An unverified account never had a session, so it owns no domain data;
    // the cascade from `user` removes its terms history, and its pending
    // reset tokens carry its id as their value. Not `deleteOperationalRowsOf`:
    // that one deletes the email's invite, but an unverified account spends
    // no invite since docs/adr/0029, so it never holds one to release
    // (docs/adr/0029's 2026-09-28 addendum).
    const stale = await db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.emailVerified, false), lt(user.createdAt, cutoff)));
    const ids = stale.map((row) => row.id);
    if (ids.length === 0) {
      return { ok: true, deleted: 0 };
    }
    const deleted = await db
      .delete(user)
      .where(and(inArray(user.id, ids), eq(user.emailVerified, false)))
      .returning({ id: user.id });
    if (deleted.length > 0) {
      await db.delete(verification).where(
        inArray(
          verification.value,
          deleted.map((row) => row.id),
        ),
      );
    }
    return { ok: true, deleted: deleted.length };
  } catch (error) {
    console.error(
      "unverified account purge failed",
      error instanceof Error ? error.name : "Unknown",
    );
    return { ok: false };
  }
}
