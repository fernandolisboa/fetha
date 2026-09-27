import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db/client";
import { invites } from "./schema";

import { normalizeEmail } from "./normalize-email";

export async function hasPendingInvite(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.email, normalizeEmail(email)), isNull(invites.consumedAt)))
    .limit(1);
  return row !== undefined;
}

export async function consumePendingInvite(
  db: Database,
  email: string,
  userId: string,
): Promise<void> {
  await db
    .update(invites)
    .set({ consumedAt: new Date(), consumedByUserId: userId })
    .where(and(eq(invites.email, normalizeEmail(email)), isNull(invites.consumedAt)));
}

// Runs after the mailbox proof has been committed (databaseHooks.user.update.after,
// onPasswordReset; docs/adr/0029): a transient failure to mark the invite consumed must
// never fail that verification or reset, and only leaves the invite pending.
export async function consumePendingInviteSafely(
  db: Database,
  email: string,
  userId: string,
): Promise<void> {
  try {
    await consumePendingInvite(db, email, userId);
  } catch (error) {
    console.error(
      "failed to consume pending invite",
      error instanceof Error ? error.name : "Unknown",
    );
  }
}
