import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

const DUPLICATE_TABLE = "42P07";

function isDuplicateTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === DUPLICATE_TABLE
  );
}

// create_monthly_partitions is defined in the market-data migration
// (drizzle/0001_market_data_reference_tables.sql). Calling it here before an
// ingestion write is idempotent (CREATE TABLE IF NOT EXISTS internally), so a
// month that already has a partition is a no-op and a new month never needs
// its own migration (docs/adr/0017). Two concurrent callers can still race
// past the IF NOT EXISTS check between Postgres sessions; 42P07 from the
// loser is swallowed here rather than failing the ingestion run.
export async function ensureMonthlyPartition(
  db: Database,
  parentTable: "candles" | "option_daily_prices",
  session: string,
): Promise<void> {
  const monthStart = `${session.slice(0, 7)}-01`;
  const monthEnd = sql`(${monthStart}::date + interval '1 month')::date`;
  try {
    await db.execute(
      sql`select create_monthly_partitions(${parentTable}, ${monthStart}::date, ${monthEnd})`,
    );
  } catch (error) {
    if (!isDuplicateTableError(error)) {
      throw error;
    }
  }
}
