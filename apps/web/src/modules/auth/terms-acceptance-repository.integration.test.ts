import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";

import { TermsAcceptanceRepository } from "./terms-acceptance-repository";

function uniqueEmail(label: string): string {
  return `fetha-terms-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<string> {
  const [row] = await getDb()
    .insert(user)
    .values({ id: crypto.randomUUID(), name: "Test User", email, emailVerified: true })
    .returning({ id: user.id });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row.id;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("TermsAcceptanceRepository isolation", () => {
  it("user A cannot read user B's terms acceptance", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);

    const userAId = await insertBareUser(emailA);
    const userBId = await insertBareUser(emailB);

    await new TermsAcceptanceRepository(db, userAId).record("2026-09-09");

    const repositoryForB = new TermsAcceptanceRepository(db, userBId);
    const bAcceptance = await repositoryForB.findLatest();

    expect(bAcceptance).toBeUndefined();

    const repositoryForA = new TermsAcceptanceRepository(db, userAId);
    const aAcceptance = await repositoryForA.findLatest();
    expect(aAcceptance?.termsVersion).toBe("2026-09-09");
  });

  it("records the version and timestamp passed at registration", async () => {
    const db = getDb();
    const email = uniqueEmail("record");
    createdEmails.push(email);
    const userId = await insertBareUser(email);
    const acceptedAt = new Date("2026-09-09T12:00:00.000Z");

    await new TermsAcceptanceRepository(db, userId).record("2026-09-09", acceptedAt);

    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row).toBeDefined();

    const acceptance = await new TermsAcceptanceRepository(db, userId).findLatest();
    expect(acceptance?.termsVersion).toBe("2026-09-09");
    expect(acceptance?.acceptedAt.toISOString()).toBe(acceptedAt.toISOString());
  });
});
