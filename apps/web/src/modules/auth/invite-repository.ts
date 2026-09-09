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

export type CreateInviteOutcome = "created" | "reopened" | "already_pending";

// The owner's path (scripts/seed-invite.mjs) into a fresh database, and the
// canonical implementation a future invite-management admin action would
// call: idempotent, and honest about what it did rather than silently
// no-op'ing on conflict.
export async function createInvite(db: Database, email: string): Promise<CreateInviteOutcome> {
  const normalized = normalizeEmail(email);

  const [existing] = await db
    .select({ consumedAt: invites.consumedAt })
    .from(invites)
    .where(eq(invites.email, normalized))
    .limit(1);

  if (!existing) {
    await db.insert(invites).values({ email: normalized });
    return "created";
  }

  if (existing.consumedAt === null) {
    return "already_pending";
  }

  await db
    .update(invites)
    .set({ consumedAt: null, consumedByUserId: null })
    .where(eq(invites.email, normalized));
  return "reopened";
}
