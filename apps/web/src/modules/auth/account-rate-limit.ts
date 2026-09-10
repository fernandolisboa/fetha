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
  constructor() {
    super("rate_limited");
    this.name = "AccountRateLimitExceededError";
  }
}

function buildKey(email: string, path: string): string {
  return `${email}|${path}`;
}

// Better Auth prunes its own `rate_limits` rows past the longest window it
// has ever seen configured (better-auth/dist/api/rate-limiter/index.mjs
// `deleteExpiredRows`); every account window here must stay at or below the
// longest Better Auth window (currently 60s) or a row could be pruned out
// from under a still-open account window.
const MAX_ATTEMPTS = 10;

async function readRow(db: Database, key: string) {
  return (await db.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1))[0];
}

// Mirrors Better Auth's own read-then-conditional-update algorithm
// (better-auth/dist/api/rate-limiter/index.mjs `consume`): every write is
// guarded by a `WHERE` clause matching the exact row state it was decided
// under, so a losing concurrent writer's `UPDATE`/`INSERT` affects zero
// rows instead of silently overwriting a winner. A losing writer re-reads
// and retries (bounded by MAX_ATTEMPTS) instead of being admitted uncounted
// or rejected on stale data.
export async function enforceAccountRateLimit(
  db: Database,
  email: string,
  path: string,
  rule: AccountRateLimitRule,
  attempt = 0,
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    throw new AccountRateLimitExceededError();
  }

  const key = buildKey(email, path);
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();

  const existing = await readRow(db, key);

  if (!existing) {
    try {
      await db.insert(rateLimit).values({ key, count: 1, lastRequest: now });
      return;
    } catch (error) {
      // Another request created the row first between our read and this
      // insert. Re-read to confirm that is what happened (a real database
      // error must still surface) and fall through to the in-window path
      // under the row that now exists, rather than letting this request
      // through uncounted.
      if (!(await readRow(db, key))) {
        throw error;
      }
      return enforceAccountRateLimit(db, email, path, rule, attempt + 1);
    }
  }

  if (now - existing.lastRequest >= windowMs) {
    const reset = await db
      .update(rateLimit)
      .set({ count: 1, lastRequest: now })
      .where(and(eq(rateLimit.key, key), lte(rateLimit.lastRequest, existing.lastRequest)))
      .returning({ id: rateLimit.id });
    if (reset.length > 0) {
      return;
    }
    // Another request already reset (or incremented) this row between our
    // read and this update; re-read and take the in-window path instead of
    // admitting this request uncounted.
    return enforceAccountRateLimit(db, email, path, rule, attempt + 1);
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

  const fresh = await readRow(db, key);
  if (!fresh || now - fresh.lastRequest >= windowMs) {
    // The row was reset (or vanished, though nothing here deletes rows)
    // between our read and this update; re-read and retry rather than
    // reject on the stale window we read at the top of this attempt.
    return enforceAccountRateLimit(db, email, path, rule, attempt + 1);
  }

  throw new AccountRateLimitExceededError();
}
