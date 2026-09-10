import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { rateLimit } from "@/db/schema/rate-limits";

import { enforceAccountRateLimit } from "./account-rate-limit";

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

describe("enforceAccountRateLimit concurrency", () => {
  // Round-3 review item 1: both window-transition branches previously failed
  // open under concurrency (insert-race losers and reset-race losers were
  // admitted uncounted). Twenty concurrent calls on a fresh key must never
  // let more than `max` through.
  it("admits at most max concurrent requests on a fresh key", async () => {
    const email = uniqueKey("fresh");
    const path = "/sign-in/email";
    createdKeys.push(`${email}|${path}`);

    const allowed = await countAllowed(email, path, 20);

    expect(allowed).toBe(RULE.max);

    const row = (
      await getDb()
        .select()
        .from(rateLimit)
        .where(eq(rateLimit.key, `${email}|${path}`))
    )[0];
    expect(row?.count).toBe(RULE.max);
  });

  it("admits at most max concurrent requests on a row whose window just expired", async () => {
    const db = getDb();
    const email = uniqueKey("backdated");
    const path = "/sign-in/email";
    const key = `${email}|${path}`;
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
