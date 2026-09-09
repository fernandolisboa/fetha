import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { invites } from "@/db/schema/invites";
import { deleteTestInvite } from "@/db/test/cleanup";

import { createInvite } from "./invite-repository";

function uniqueEmail(label: string): string {
  return `fetha-invite-${label}-${crypto.randomUUID()}@example.com`;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestInvite(db, email);
  }
});

describe("createInvite", () => {
  it("creates a pending invite for a brand-new email", async () => {
    const db = getDb();
    const email = uniqueEmail("new");
    createdEmails.push(email);

    const outcome = await createInvite(db, email);

    expect(outcome).toBe("created");
    const [row] = await db.select().from(invites).where(eq(invites.email, email));
    expect(row?.consumedAt).toBeNull();
  });

  it("reports already_pending and changes nothing for an unconsumed invite", async () => {
    const db = getDb();
    const email = uniqueEmail("pending");
    createdEmails.push(email);
    await db.insert(invites).values({ email });

    const outcome = await createInvite(db, email);

    expect(outcome).toBe("already_pending");
  });

  it("reopens a consumed invite", async () => {
    const db = getDb();
    const email = uniqueEmail("consumed");
    createdEmails.push(email);
    await db.insert(invites).values({
      email,
      consumedAt: new Date(),
      consumedByUserId: null,
    });

    const outcome = await createInvite(db, email);

    expect(outcome).toBe("reopened");
    const [row] = await db.select().from(invites).where(eq(invites.email, email));
    expect(row?.consumedAt).toBeNull();
  });
});
