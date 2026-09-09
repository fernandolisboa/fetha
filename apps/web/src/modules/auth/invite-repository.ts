import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db/client";
import { invites } from "@/db/schema/invites";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

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

export async function createInvite(db: Database, email: string): Promise<void> {
  await db.insert(invites).values({ email: normalizeEmail(email) });
}
