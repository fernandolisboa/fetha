import { eq, or, sql } from "drizzle-orm";

import type { Database } from "@/db/client";

import { normalizeEmail } from "./normalize-email";
import { invites, mailOutbox, verification } from "./schema";

// Rows that name the user without a `user_id`, so the cascade from `user`
// cannot reach them (docs/adr/0027): invites, captured mail, and pending
// password-reset (value = user id) and magic-link (value = JSON with the
// email) tokens. `rate_limits` keeps only an email hash for about a minute
// (ADR-0024) and is left to its own purge.
export async function deleteOperationalRowsOf(
  db: Database,
  deleted: { id: string; email: string },
): Promise<void> {
  const email = normalizeEmail(deleted.email);
  await db
    .delete(invites)
    .where(or(eq(invites.email, email), eq(invites.consumedByUserId, deleted.id)));
  await db.delete(mailOutbox).where(sql`lower(${mailOutbox.to}) = ${email}`);
  await db
    .delete(verification)
    .where(
      or(
        eq(verification.value, deleted.id),
        sql`${verification.value} like '{%' and lower(${verification.value}::jsonb ->> 'email') = ${email}`,
      ),
    );
}
