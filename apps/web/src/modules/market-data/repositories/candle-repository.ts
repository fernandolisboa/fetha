import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles } from "@/db/schema/market-data";

import type { CotahistStockRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

const DAILY_TIMEFRAME = "1d";

export async function upsertDailyCandles(
  db: Database,
  session: string,
  asOf: Date,
  rows: CotahistStockRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  await ensureMonthlyPartition(db, "candles", session);

  await db
    .insert(candles)
    .values(
      rows.map((row) => ({
        ticker: row.ticker,
        timeframe: DAILY_TIMEFRAME,
        session: row.session,
        asOf,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        tradedQuantity: row.tradedQuantity,
      })),
    )
    .onConflictDoUpdate({
      target: [candles.ticker, candles.timeframe, candles.session],
      set: {
        asOf,
        open: sql`excluded.open`,
        high: sql`excluded.high`,
        low: sql`excluded.low`,
        close: sql`excluded.close`,
        tradedQuantity: sql`excluded.traded_quantity`,
      },
    });

  return rows.length;
}
