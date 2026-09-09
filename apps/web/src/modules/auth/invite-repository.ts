import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db/client";
import { invites } from "@/db/schema/invites";

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

// The user row already exists by the time this runs (databaseHooks.user.create.after):
// a transient failure to mark the invite consumed must never undo or fail a registration
// that already succeeded (docs/adr/0016, mirrors recordTermsAcceptanceHistory).
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
