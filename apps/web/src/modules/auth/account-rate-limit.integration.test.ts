import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { rateLimit } from "./schema";

import {
  ACCOUNT_BUCKET_RETENTION_SECONDS,
  accountBucketKey,
  enforceAccountRateLimit,
} from "./account-rate-limit";

function uniqueKey(label: string): string {
  return `fetha-account-rate-limit-${label}-${crypto.randomUUID()}@example.com`;
}

const createdKeys: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const key of createdKeys.splice(0)) {
    await db.delete(rateLimit).where(eq(rateLimit.key, key));
  }
});

const RULE = { windowSeconds: 60, max: 3 };

async function countAllowed(email: string, path: string, attempts: number): Promise<number> {
  const db = getDb();
  const results = await Promise.allSettled(
    Array.from({ length: attempts }, () => enforceAccountRateLimit(db, email, path, RULE)),
  );
  return results.filter((result) => result.status === "fulfilled").length;
}

describe("enforceAccountRateLimit retention", () => {
  it("purges buckets older than the retention when a bucket starts a new window (#64)", async () => {
    const db = getDb();
    const stale = accountBucketKey(uniqueKey("stale"), "/sign-in/email");
    const live = accountBucketKey(uniqueKey("live"), "/sign-in/email");
    const ipBucket = `203.0.113.7|/sign-in/email-${crypto.randomUUID()}`;
    const email = uniqueKey("trigger");
    const path = "/sign-in/email";
    createdKeys.push(stale, live, ipBucket, accountBucketKey(email, path));

    const longAgo = Date.now() - (ACCOUNT_BUCKET_RETENTION_SECONDS * 1000 + 1000);
    await db.insert(rateLimit).values([
      { key: stale, count: 1, lastRequest: longAgo },
      { key: live, count: 1, lastRequest: Date.now() - 1000 },
      { key: ipBucket, count: 1, lastRequest: longAgo },
      { key: accountBucketKey(email, path), count: RULE.max, lastRequest: longAgo },
    ]);

    await enforceAccountRateLimit(db, email, path, RULE);

    const keys = (await db.select({ key: rateLimit.key }).from(rateLimit)).map((row) => row.key);
    expect(keys).not.toContain(stale);
    expect(keys).toContain(live);
    expect(keys).toContain(ipBucket);
    const [trigger] = await db
      .select()
      .from(rateLimit)
      .where(eq(rateLimit.key, accountBucketKey(email, path)));
    expect(trigger?.count).toBe(1);
  });
});

describe("enforceAccountRateLimit concurrency", () => {
  // Round-3 review item 1: both window-transition branches previously failed
  // open under concurrency (insert-race losers and reset-race losers were
  // admitted uncounted). Twenty concurrent calls on a fresh key must never
  // let more than `max` through.
  it("admits at most max concurrent requests on a fresh key", async () => {
    const email = uniqueKey("fresh");
    const path = "/sign-in/email";
    createdKeys.push(accountBucketKey(email, path));

    const allowed = await countAllowed(email, path, 20);

    expect(allowed).toBe(RULE.max);

    const row = (
      await getDb()
        .select()
        .from(rateLimit)
        .where(eq(rateLimit.key, accountBucketKey(email, path)))
    )[0];
    expect(row?.count).toBe(RULE.max);
  });

  it("admits at most max concurrent requests on a row whose window just expired", async () => {
    const db = getDb();
    const email = uniqueKey("backdated");
    const path = "/sign-in/email";
    const key = accountBucketKey(email, path);
    createdKeys.push(key);

    await db.insert(rateLimit).values({
      key,
      count: RULE.max,
      lastRequest: Date.now() - (RULE.windowSeconds * 1000 + 1000),
    });

    const allowed = await countAllowed(email, path, 20);

    expect(allowed).toBe(RULE.max);

    const row = (await db.select().from(rateLimit).where(eq(rateLimit.key, key)))[0];
    expect(row?.count).toBe(RULE.max);
  });
});
