import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { IngestionSource } from "@/db/schema/market-data";

// One ingestion source at a time, across concurrent cron/manual invocations
// (docs/adr/0017): the transaction-scoped lock is released automatically at
// commit or rollback, so a crashed run never leaves it held.
export async function withSourceLock<T>(
  db: Database,
  source: IngestionSource,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${source}))`);
    // drizzle's transaction handle implements the same query builder surface
    // as Database; the nominal type differs only in commit/rollback methods
    // the repositories here never call.
    return fn(tx as unknown as Database);
  });
}
