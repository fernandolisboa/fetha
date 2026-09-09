import { and, eq, gt, lt, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { rateLimit } from "@/db/schema";

// Same table Better Auth's own database-backed rate limiter uses
// (docs/adr/0016), keyed `email|path` instead of `ip|path` so the two
// buckets never collide (an email always contains "@", an IP address
// never does): this closes the A-01 gap where limiting was IP-and-path
// only, so a distributed attacker rotating IPs against one account was
// unbounded (docs/security-audit/2026-09-09.md).
export interface AccountRateLimitRule {
  windowSeconds: number;
  max: number;
}

export class AccountRateLimitExceededError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("rate_limited");
    this.name = "AccountRateLimitExceededError";
  }
}

function buildKey(email: string, path: string): string {
  return `${email}|${path}`;
}

// Mirrors Better Auth's own read-then-conditional-update algorithm
// (better-auth/dist/api/rate-limiter/index.mjs `consume`): a fresh window
// resets the counter with a conditional update guarded by the previously
// read `lastRequest`, and a hit inside the window increments only if the
// row still matches the window/max it was read under, so a losing
// concurrent writer re-reads instead of silently overwriting a winner.
export async function enforceAccountRateLimit(
  db: Database,
  email: string,
  path: string,
  rule: AccountRateLimitRule,
): Promise<void> {
  const key = buildKey(email, path);
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();

  const existing = (await db.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1))[0];

  if (!existing) {
    try {
      await db.insert(rateLimit).values({ key, count: 1, lastRequest: now });
    } catch {
      // Another request created the row first between our read and this
      // insert; that request already gets its own accounting, so this one
      // is let through rather than retried.
    }
    return;
  }

  if (now - existing.lastRequest >= windowMs) {
    await db
      .update(rateLimit)
      .set({ count: 1, lastRequest: now })
      .where(and(eq(rateLimit.key, key), lte(rateLimit.lastRequest, existing.lastRequest)));
    return;
  }

  const windowStart = now - windowMs;
  const updated = await db
    .update(rateLimit)
    .set({ count: sql`${rateLimit.count} + 1`, lastRequest: now })
    .where(
      and(
        eq(rateLimit.key, key),
        gt(rateLimit.lastRequest, windowStart),
        lt(rateLimit.count, rule.max),
      ),
    )
    .returning({ id: rateLimit.id });

  if (updated.length > 0) {
    return;
  }

  throw new AccountRateLimitExceededError(
    Math.max(1, Math.ceil((existing.lastRequest + windowMs - now) / 1000)),
  );
}
