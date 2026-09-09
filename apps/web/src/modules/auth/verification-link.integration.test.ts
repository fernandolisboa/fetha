import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { mailOutbox } from "@/db/schema/mail-outbox";

import { findLatestVerificationLink } from "./verification-link";

function uniqueEmail(label: string): string {
  return `fetha-verification-link-${label}-${crypto.randomUUID()}@example.com`;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await db.delete(mailOutbox).where(eq(mailOutbox.to, email));
  }
});

describe("findLatestVerificationLink", () => {
  it("extracts the link and deletes the row so it cannot be replayed", async () => {
    const db = getDb();
    const email = uniqueEmail("replay");
    createdEmails.push(email);

    await db.insert(mailOutbox).values({
      to: email,
      subject: "Confirm",
      text: "Click https://fetha.app/verify?token=abc to confirm.",
      html: "<p>Click</p>",
    });

    const link = await findLatestVerificationLink(db, email);
    expect(link).toBe("https://fetha.app/verify?token=abc");

    const rows = await db.select().from(mailOutbox).where(eq(mailOutbox.to, email));
    expect(rows).toHaveLength(0);

    const secondRead = await findLatestVerificationLink(db, email);
    expect(secondRead).toBeUndefined();
  });

  it("returns undefined when no email was captured", async () => {
    const db = getDb();
    const link = await findLatestVerificationLink(db, uniqueEmail("missing"));
    expect(link).toBeUndefined();
  });
});
