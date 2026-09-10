import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles } from "@/db/schema/market-data";

import type { CotahistStockRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

const DAILY_TIMEFRAME = "1d";
const CHUNK_SIZE = 1000;

export interface CandleRow {
  ticker: string;
  session: string;
  asOf: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  tradedQuantity: number;
}

export interface InstrumentSearchResult {
  ticker: string;
  session: string;
  close: string;
}

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

export async function latestCandle(db: Database, ticker: string): Promise<CandleRow | null> {
  const [row] = await db
    .select({
      ticker: candles.ticker,
      session: candles.session,
      asOf: candles.asOf,
      open: candles.open,
      high: candles.high,
      low: candles.low,
      close: candles.close,
      tradedQuantity: candles.tradedQuantity,
    })
    .from(candles)
    .where(and(eq(candles.ticker, ticker), eq(candles.timeframe, DAILY_TIMEFRAME)))
    .orderBy(desc(candles.session))
    .limit(1);
  return row ?? null;
}

// Reference data only (ADR-0017): no per-user scope. Bounded to `limit`
// distinct tickers and resolved with one query per match rather than a
// window function, since a search-as-you-type call stays well under a
// couple dozen matches (the instrument combobox, #13).
export async function searchInstruments(
  db: Database,
  query: string,
  limit: number,
): Promise<InstrumentSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const pattern = `${trimmed}%`;
  const matches = await db
    .selectDistinct({ ticker: candles.ticker })
    .from(candles)
    .where(and(eq(candles.timeframe, DAILY_TIMEFRAME), ilike(candles.ticker, pattern)))
    .orderBy(asc(candles.ticker))
    .limit(limit);

  const results = await Promise.all(matches.map(async ({ ticker }) => latestCandle(db, ticker)));
  return results
    .filter((row): row is CandleRow => row !== null)
    .map((row) => ({ ticker: row.ticker, session: row.session, close: row.close }));
}

// Oldest first, bounded to the last `limit` sessions: the shape a candle
// chart and the engine's `indicators()` both want (CONTEXT.md's "data views
// by instrument, timeframe and date range").
export async function recentDailyCandles(
  db: Database,
  ticker: string,
  limit: number,
): Promise<CandleRow[]> {
  const rows = await db
    .select({
      ticker: candles.ticker,
      session: candles.session,
      asOf: candles.asOf,
      open: candles.open,
      high: candles.high,
      low: candles.low,
      close: candles.close,
      tradedQuantity: candles.tradedQuantity,
    })
    .from(candles)
    .where(and(eq(candles.ticker, ticker), eq(candles.timeframe, DAILY_TIMEFRAME)))
    .orderBy(desc(candles.session))
    .limit(limit);
  return rows.reverse();
}
