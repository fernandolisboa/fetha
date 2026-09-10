import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles } from "@/db/schema/market-data";

import type { CotahistStockRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

const DAILY_TIMEFRAME = "1d";
const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeByTicker(rows: CotahistStockRow[]): CotahistStockRow[] {
  const byTicker = new Map<string, CotahistStockRow>();
  for (const row of rows) {
    byTicker.set(`${row.ticker}:${row.session}`, row);
  }
  return [...byTicker.values()];
}

export async function upsertDailyCandles(
  db: Database,
  session: string,
  asOf: Date,
  rows: CotahistStockRow[],
): Promise<number> {
  const deduped = dedupeByTicker(rows);
  if (deduped.length === 0) {
    return 0;
  }
  await ensureMonthlyPartition(db, "candles", session);

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(candles)
      .values(
        batch.map((row) => ({
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
  }

  return deduped.length;
}
