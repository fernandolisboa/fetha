import { desc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { mailOutbox } from "./schema";

const URL_PATTERN = /https?:\/\/\S+/;

function extractLink(text: string): string | undefined {
  return URL_PATTERN.exec(text)?.[0];
}

// Captured email is single-use test data (docs/adr/0016): reading the
// latest verification link for an email also removes the row, so a leaked
// E2E route response or a re-run test can never replay a stale link.
export async function findLatestVerificationLink(
  db: Database,
  email: string,
): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(mailOutbox)
    .where(eq(mailOutbox.to, email))
    .orderBy(desc(mailOutbox.sentAt))
    .limit(1);

  if (!row) {
    return undefined;
  }

  await db.delete(mailOutbox).where(eq(mailOutbox.id, row.id));

  return extractLink(row.text);
}
