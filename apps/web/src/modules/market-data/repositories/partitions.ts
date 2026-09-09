import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";

// create_monthly_partitions is defined in the market-data migration
// (drizzle/0001_market_data_reference_tables.sql). Calling it here before an
// ingestion write is idempotent (CREATE TABLE IF NOT EXISTS internally), so a
// month that already has a partition is a no-op and a new month never needs
// its own migration (docs/adr/0017).
export async function ensureMonthlyPartition(
  db: Database,
  parentTable: "candles" | "option_daily_prices",
  session: string,
): Promise<void> {
  const monthStart = `${session.slice(0, 7)}-01`;
  const monthEnd = sql`(${monthStart}::date + interval '1 month')::date`;
  await db.execute(
    sql`select create_monthly_partitions(${parentTable}, ${monthStart}::date, ${monthEnd})`,
  );
}
