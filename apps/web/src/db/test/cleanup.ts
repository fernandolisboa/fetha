import { eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { invites } from "@/db/schema/invites";
import { mailOutbox } from "@/db/schema/mail-outbox";
import { user, verification } from "@/db/schema/auth";

// CI resets and migrates fetha-preview before every run (docs/adr/0016), so
// this cleanup is a courtesy for local and interleaved-run hygiene, not the
// thing tenant isolation relies on; a failure here must never fail the test
// that already asserted what it needed to.
async function deleteQuietly(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    console.warn("test cleanup step failed", error instanceof Error ? error.name : "Unknown");
  }
}

export async function deleteTestUser(db: Database, email: string): Promise<void> {
  await deleteQuietly(db.delete(user).where(eq(user.email, email)));
  await deleteQuietly(db.delete(mailOutbox).where(eq(mailOutbox.to, email)));
  await deleteQuietly(db.delete(verification).where(eq(verification.identifier, email)));
}

export async function deleteTestInvite(db: Database, email: string): Promise<void> {
  await deleteQuietly(db.delete(invites).where(eq(invites.email, email)));
}
