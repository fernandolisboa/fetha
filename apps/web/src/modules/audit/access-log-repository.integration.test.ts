import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import { AccessLogRepository } from "./access-log-repository";
import { purgeExpiredAccessLog } from "./retention";
import { accessLog } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const context = { ipAddress: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" };

function uniqueEmail(label: string): string {
  return `fetha-audit-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string; name: string; email: string }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email,
      emailVerified: true,
      termsVersion: "2026-09-09",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function twoUsers(label: string) {
  const emailA = uniqueEmail(`${label}-a`);
  const emailB = uniqueEmail(`${label}-b`);
  createdEmails.push(emailA, emailB);
  return { userA: await insertBareUser(emailA), userB: await insertBareUser(emailB) };
}

describe("AccessLogRepository isolation", () => {
  it("user A cannot read user B's access log", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("read");

    await new AccessLogRepository(db, userB).record("portfolio_read", context);

    expect(await new AccessLogRepository(db, userA).listRecent(50)).toEqual([]);
    expect(await new AccessLogRepository(db, userB).listRecent(50)).toHaveLength(1);
  });

  it("user A's record never lands in user B's log", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("write");

    await new AccessLogRepository(db, userA).record("decisions_read", context);

    const rows = await db.select().from(accessLog).where(eq(accessLog.userId, userB.id));
    expect(rows).toEqual([]);
  });
});

describe("AccessLogRepository", () => {
  it("lists the newest entries first with what was recorded", async () => {
    const db = getDb();
    const { userA } = await twoUsers("list");
    const repository = new AccessLogRepository(db, userA);
    const earlier = new Date(Date.now() - 60_000);

    await repository.record("portfolio_read", context, earlier);
    await repository.record("data_export", { ipAddress: null, userAgent: null });

    const entries = await repository.listRecent(50);
    expect(entries.map((entry) => entry.event)).toEqual(["data_export", "portfolio_read"]);
    expect(entries[1]).toMatchObject({
      occurredAt: earlier,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    expect(entries[0]).toMatchObject({ ipAddress: null, userAgent: null });
    expect(await repository.listRecent(1)).toHaveLength(1);
  });

  it("the nightly purge drops every user's entries older than 180 days, and only those", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("retention");
    const now = new Date();
    const expired = new Date(now.getTime() - 181 * DAY_MS);
    const kept = new Date(now.getTime() - 179 * DAY_MS);

    await new AccessLogRepository(db, userA).record("portfolio_read", context, expired);
    await new AccessLogRepository(db, userA).record("decisions_read", context, kept);
    await new AccessLogRepository(db, userB).record("portfolio_read", context, expired);

    const outcome = await purgeExpiredAccessLog(db, now);

    expect(outcome).toMatchObject({ ok: true });
    const entriesA = await new AccessLogRepository(db, userA).listRecent(50);
    expect(entriesA.map((entry) => entry.event)).toEqual(["decisions_read"]);
    expect(await new AccessLogRepository(db, userB).listRecent(50)).toEqual([]);
  });

  it("refuses an event outside the vocabulary", async () => {
    const db = getDb();
    const { userA } = await twoUsers("check");

    await expect(
      db.insert(accessLog).values({ userId: userA.id, event: "made_up" }),
    ).rejects.toThrow();
  });

  it("goes with the account", async () => {
    const db = getDb();
    const { userA } = await twoUsers("cascade");
    await new AccessLogRepository(db, userA).record("portfolio_read", context);

    await db.delete(user).where(eq(user.id, userA.id));

    const rows = await db.select().from(accessLog).where(eq(accessLog.userId, userA.id));
    expect(rows).toEqual([]);
  });
});
