import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";

import { invites, user, verification } from "./schema";
import { purgeUnverifiedAccounts, UNVERIFIED_ACCOUNT_RETENTION_HOURS } from "./unverified-accounts";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2026-09-27T03:00:00Z");

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
    await deleteTestInvite(db, email);
  }
});

async function insertUser(label: string, emailVerified: boolean, ageHours: number) {
  const email = `fetha-unverified-${label}-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  const createdAt = new Date(NOW.getTime() - ageHours * HOUR_MS);
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: label,
      email,
      emailVerified,
      termsVersion: "2026-09-27",
      termsAcceptedAt: createdAt,
      createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return row;
}

async function remainingIds(ids: string[]): Promise<string[]> {
  const rows = await getDb().select({ id: user.id }).from(user).where(inArray(user.id, ids));
  return rows.map((row) => row.id).sort();
}

describe("purgeUnverifiedAccounts", () => {
  it("deletes only unverified accounts older than the retention window, idempotently", async () => {
    const stale = await insertUser("stale", false, UNVERIFIED_ACCOUNT_RETENTION_HOURS + 1);
    const fresh = await insertUser("fresh", false, UNVERIFIED_ACCOUNT_RETENTION_HOURS - 1);
    const verifiedOld = await insertUser("verified", true, UNVERIFIED_ACCOUNT_RETENTION_HOURS * 30);
    const ids = [stale.id, fresh.id, verifiedOld.id];

    const first = await purgeUnverifiedAccounts(getDb(), NOW);
    expect(first).toMatchObject({ ok: true });
    expect(first.ok && first.deleted).toBeGreaterThanOrEqual(1);
    expect(await remainingIds(ids)).toEqual([fresh.id, verifiedOld.id].sort());

    const second = await purgeUnverifiedAccounts(getDb(), NOW);
    expect(second).toMatchObject({ ok: true });
    expect(await remainingIds(ids)).toEqual([fresh.id, verifiedOld.id].sort());
  });

  it("deletes the purged account's pending password-reset tokens", async () => {
    const stale = await insertUser("stale-token", false, UNVERIFIED_ACCOUNT_RETENTION_HOURS + 1);
    const identifier = `reset-password:${crypto.randomUUID()}`;
    await getDb()
      .insert(verification)
      .values({
        id: crypto.randomUUID(),
        identifier,
        value: stale.id,
        expiresAt: new Date(NOW.getTime() + HOUR_MS),
      });

    await purgeUnverifiedAccounts(getDb(), NOW);

    const rows = await getDb()
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier));
    expect(rows).toHaveLength(0);
  });

  it("keeps an invite spent when the account holding it is purged", async () => {
    const stale = await insertUser("stale-invite", false, UNVERIFIED_ACCOUNT_RETENTION_HOURS + 1);
    await getDb()
      .insert(invites)
      .values({ email: stale.email, consumedAt: stale.createdAt, consumedByUserId: stale.id });

    await purgeUnverifiedAccounts(getDb(), NOW);

    const [invite] = await getDb().select().from(invites).where(eq(invites.email, stale.email));
    expect(invite?.consumedAt).toEqual(stale.createdAt);
    expect(invite?.consumedByUserId).toBeNull();
  });
});
