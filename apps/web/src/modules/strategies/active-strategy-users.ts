import { asc, eq } from "drizzle-orm";

import type { Database } from "@/db/client";
import { strategies } from "@/db/schema/strategies";

// A pure hash of `rotateKey` folded into `[0, length)`, deterministic for a
// given (key, length) pair: the same session always rotates the same
// ascending user-id list to the same starting point, but a different
// session rotates it to a different one (#19 round 2 item 1). Not
// cryptographic, only needs to spread evenly across a short user list.
export function rotationOffset(rotateKey: string, length: number): number {
  if (length <= 0) {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < rotateKey.length; index += 1) {
    hash = (Math.imul(31, hash) + rotateKey.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % length;
}

// The nightly evaluation's loop driver (#19): the ids of every user with at
// least one active strategy, nothing else about their strategies. Every
// per-user read after this goes through StrategiesRepository, WatchlistRepository
// and SignalsRepository constructed with that id (CLAUDE.md principle 5: no
// method on a user-scoped repository accepts a user id parameter — this
// function is not one, it drives the loop that constructs them). Whether a
// strategy is daily is checked once the caller has the user's own
// StrategiesRepository, not here, so this function never reads strategy
// content across tenants.
//
// The base order is userId ascending — deterministic and stable across runs
// with the same active-strategy set — then rotated by `rotateKey` (the
// newest session this run is evaluating, round 2 item 1): a deadline that
// only reaches part of the list stops at a different point each night
// instead of always exhausting the budget on the same users sorted last.
export async function activeStrategyUserIds(db: Database, rotateKey?: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: strategies.userId })
    .from(strategies)
    .where(eq(strategies.active, true))
    .orderBy(asc(strategies.userId));
  const ids = rows.map((row) => row.userId);
  if (!rotateKey || ids.length === 0) {
    return ids;
  }
  const offset = rotationOffset(rotateKey, ids.length);
  return [...ids.slice(offset), ...ids.slice(0, offset)];
}
