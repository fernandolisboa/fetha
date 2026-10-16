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

  it("user A cannot list, count or see the origins of user B's access log", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("isolation-page");

    await new AccessLogRepository(db, userB).record("portfolio_read", context);

    const repositoryA = new AccessLogRepository(db, userA);
    expect((await repositoryA.listPage({}, null, 50)).entries).toEqual([]);
    expect(await repositoryA.count({})).toBe(0);
    expect(await repositoryA.listOrigins()).toEqual([]);

    const repositoryB = new AccessLogRepository(db, userB);
    expect((await repositoryB.listPage({}, null, 50)).entries).toHaveLength(1);
    expect(await repositoryB.count({})).toBe(1);
    expect(await repositoryB.listOrigins()).toEqual([context.ipAddress]);
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

  it("paginates newest first with keyset cursors, breaking ties on id", async () => {
    const db = getDb();
    const { userA } = await twoUsers("keyset");
    const repository = new AccessLogRepository(db, userA);
    const tied = new Date("2026-05-01T12:00:00.000Z");
    const earlier = new Date("2026-04-01T12:00:00.000Z");

    await repository.record("portfolio_read", context, tied);
    await repository.record("decisions_read", context, tied);
    await repository.record("data_export", context, earlier);

    const firstPage = await repository.listPage({}, null, 2);
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.entries.every((entry) => entry.occurredAt.getTime() === tied.getTime())).toBe(
      true,
    );
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await repository.listPage({}, firstPage.nextCursor, 2);
    expect(secondPage.entries.map((entry) => entry.event)).toEqual(["data_export"]);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = [...firstPage.entries, ...secondPage.entries].map((entry) => entry.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it("filters listPage by event and by origin", async () => {
    const db = getDb();
    const { userA } = await twoUsers("filters");
    const repository = new AccessLogRepository(db, userA);
    const otherContext = { ipAddress: "198.51.100.9", userAgent: context.userAgent };

    await repository.record("portfolio_read", context);
    await repository.record("decisions_read", context);
    await repository.record("portfolio_read", otherContext);

    const byEvent = await repository.listPage({ event: "portfolio_read" }, null, 50);
    expect(byEvent.entries).toHaveLength(2);
    expect(byEvent.entries.every((entry) => entry.event === "portfolio_read")).toBe(true);

    const byOrigin = await repository.listPage({ ipAddress: context.ipAddress }, null, 50);
    expect(byOrigin.entries).toHaveLength(2);
    expect(byOrigin.entries.every((entry) => entry.ipAddress === context.ipAddress)).toBe(true);
  });

  it("treats from/to as São Paulo calendar days, inclusive", async () => {
    const db = getDb();
    const { userA } = await twoUsers("sp-day");
    const repository = new AccessLogRepository(db, userA);
    // 02:30 UTC is 23:30 the previous day in America/Sao_Paulo (UTC-3).
    const at = new Date("2026-01-10T02:30:00.000Z");
    await repository.record("portfolio_read", context, at);

    const previousDay = await repository.listPage(
      { from: "2026-01-09", to: "2026-01-09" },
      null,
      50,
    );
    expect(previousDay.entries).toHaveLength(1);

    const sameUtcDay = await repository.listPage(
      { from: "2026-01-10", to: "2026-01-10" },
      null,
      50,
    );
    expect(sameUtcDay.entries).toHaveLength(0);
  });

  it("counts matching rows the same way listPage filters them", async () => {
    const db = getDb();
    const { userA } = await twoUsers("count");
    const repository = new AccessLogRepository(db, userA);

    await repository.record("portfolio_read", context);
    await repository.record("decisions_read", context);

    expect(await repository.count({})).toBe(2);
    expect(await repository.count({ event: "portfolio_read" })).toBe(1);
  });

  it("lists distinct origins newest first", async () => {
    const db = getDb();
    const { userA } = await twoUsers("origins");
    const repository = new AccessLogRepository(db, userA);
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");

    await repository.record(
      "portfolio_read",
      { ipAddress: "198.51.100.9", userAgent: null },
      older,
    );
    await repository.record("portfolio_read", { ipAddress: "203.0.113.7", userAgent: null }, newer);
    await repository.record(
      "decisions_read",
      { ipAddress: "198.51.100.9", userAgent: null },
      older,
    );
    await repository.record("data_export", { ipAddress: null, userAgent: null });

    expect(await repository.listOrigins()).toEqual(["203.0.113.7", "198.51.100.9"]);
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
