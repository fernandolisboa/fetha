import { createHash } from "node:crypto";

import { and, eq, gt, like, lt, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { rateLimit } from "./schema";

// Same table Better Auth's own database-backed rate limiter uses
// (docs/adr/0016), keyed by a hash of the email instead of `ip|path`: this
// closes the A-01 gap where limiting was IP-and-path only, so a distributed
// attacker rotating IPs against one account was unbounded
// (docs/security-audit/2026-09-09.md). The `account:` prefix can never
// start an IP address, so the two bucket shapes never collide.
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

const ACCOUNT_KEY_PREFIX = "account:";

// Buckets older than this are deleted whenever a bucket starts a new window,
// so no rule's window may exceed it or a live bucket could be purged (#64).
export const ACCOUNT_BUCKET_RETENTION_SECONDS = 60;

// The email is hashed so the table never holds addresses in clear, including
// ones typed at sign-in that never had an account (#64, docs/adr/0018).
export function accountBucketKey(email: string, path: string): string {
  const digest = createHash("sha256").update(email).digest("base64url");
  return `${ACCOUNT_KEY_PREFIX}${digest}|${path}`;
}

async function purgeExpiredAccountBuckets(db: Database, now: number): Promise<void> {
  await db
    .delete(rateLimit)
    .where(
      and(
        like(rateLimit.key, `${ACCOUNT_KEY_PREFIX}%`),
        lt(rateLimit.lastRequest, now - ACCOUNT_BUCKET_RETENTION_SECONDS * 1000),
      ),
    );
}

// Bounded to prevent retry storms; constraint that every account window stays at or below Better Auth's longest documented window lives in docs/adr/0018.
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
  if (rule.windowSeconds > ACCOUNT_BUCKET_RETENTION_SECONDS) {
    throw new Error(`account rate-limit window for ${path} exceeds the bucket retention`);
  }
  if (attempt >= MAX_ATTEMPTS) {
    throw new AccountRateLimitExceededError();
  }

  const key = accountBucketKey(email, path);
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();

  const existing = await readRow(db, key);

  if (!existing) {
    try {
      await db.insert(rateLimit).values({ key, count: 1, lastRequest: now });
      await purgeExpiredAccountBuckets(db, now);
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
      await purgeExpiredAccountBuckets(db, now);
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
    // The row was reset (or purged as expired) between our read and this
    // update; re-read and retry rather than
    // reject on the stale window we read at the top of this attempt.
    return enforceAccountRateLimit(db, email, path, rule, attempt + 1);
  }

  throw new AccountRateLimitExceededError();
}
