import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { purgeExpiredSessions } from "./expired-sessions";
import { session, user } from "./schema";

const NOW = new Date("2026-09-27T03:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<string> {
  const email = `fetha-expired-sessions-${label}-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  const id = crypto.randomUUID();
  await getDb().insert(user).values({
    id,
    name: label,
    email,
    emailVerified: true,
    termsVersion: "2026-09-27",
    termsAcceptedAt: NOW,
  });
  return id;
}

async function insertSession(userId: string, expiresAt: Date): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(session).values({
    id,
    userId,
    token: crypto.randomUUID(),
    expiresAt,
    ipAddress: "203.0.113.7",
    userAgent: "test",
    updatedAt: NOW,
  });
  return id;
}

describe("purgeExpiredSessions", () => {
  it("deletes expired sessions of every user and keeps live ones", async () => {
    const alice = await insertUser("alice");
    const bob = await insertUser("bob");
    const aliceExpired = await insertSession(alice, new Date(NOW.getTime() - 1000));
    const aliceLive = await insertSession(alice, new Date(NOW.getTime() + DAY_MS));
    const bobExpired = await insertSession(bob, new Date(NOW.getTime() - 30 * DAY_MS));
    const bobLive = await insertSession(bob, new Date(NOW.getTime() + 1000));

    const outcome = await purgeExpiredSessions(getDb(), NOW);

    expect(outcome.ok).toBe(true);
    const remaining = await getDb()
      .select({ id: session.id })
      .from(session)
      .where(inArray(session.id, [aliceExpired, aliceLive, bobExpired, bobLive]));
    expect(remaining.map((row) => row.id).sort()).toEqual([aliceLive, bobLive].sort());
  });
});
