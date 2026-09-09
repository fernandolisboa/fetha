import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { invites } from "@/db/schema/invites";
import { mailOutbox } from "@/db/schema/mail-outbox";
import { user } from "@/db/schema/auth";

// The CI database is a shared, long-lived Neon branch (not reset between
// runs), so every integration test must delete exactly what it created.
export async function deleteTestUser(db: Database, email: string): Promise<void> {
  await db.delete(user).where(eq(user.email, email));
  await db.delete(mailOutbox).where(eq(mailOutbox.to, email));
}

export async function deleteTestInvite(db: Database, email: string): Promise<void> {
  await db.delete(invites).where(eq(invites.email, email));
}
