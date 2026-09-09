import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import type { InstrumentOptionSeries } from "../adapters/b3-instruments/schema";
import type { CotahistOptionRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return [...byKey.values()];
}

// isin is the registry's stable natural key (B3 reuses option tickers and
// adjusts strikes across cycles, ADR-0017); as_of is set once on first sight
// and only ever moves backward on conflict (LEAST), so a re-ingested older
// registry snapshot can never erase a newer as_of a later run already
// recorded, while ticker/underlying/right/strike/expiry/style stay current.
export async function upsertOptionSeries(
  db: Database,
  asOf: Date,
  rows: InstrumentOptionSeries[],
): Promise<number> {
  const deduped = dedupeByKey(rows, (row) => row.isin);
  if (deduped.length === 0) {
    return 0;
  }

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(optionSeries)
      .values(
        batch.map((row) => ({
          isin: row.isin,
          ticker: row.ticker,
          underlying: row.underlying,
          right: row.right,
          strike: row.strike,
          expiry: row.expiry,
          style: row.style,
          asOf,
        })),
      )
      .onConflictDoUpdate({
        target: optionSeries.isin,
        set: {
          ticker: sql`excluded.ticker`,
          underlying: sql`excluded.underlying`,
          right: sql`excluded.right`,
          strike: sql`excluded.strike`,
          expiry: sql`excluded.expiry`,
          style: sql`excluded.style`,
          asOf: sql`least(${optionSeries.asOf}, excluded.as_of)`,
        },
      });
  }

  return deduped.length;
}

export async function upsertOptionDailyPrices(
  db: Database,
  session: string,
  asOf: Date,
  rows: CotahistOptionRow[],
): Promise<number> {
  const deduped = dedupeByKey(rows, (row) => `${row.ticker}:${row.session}`);
  if (deduped.length === 0) {
    return 0;
  }
  await ensureMonthlyPartition(db, "option_daily_prices", session);

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(optionDailyPrices)
      .values(
        batch.map((row) => ({
          ticker: row.ticker,
          session: row.session,
          asOf,
          right: row.right,
          strike: row.strike,
          expiry: row.expiry,
          average: hasTrades(row) ? row.average : null,
          close: hasTrades(row) ? row.close : null,
          trades: row.trades,
          tradedQuantity: row.tradedQuantity,
        })),
      )
      .onConflictDoUpdate({
        target: [optionDailyPrices.ticker, optionDailyPrices.session],
        set: {
          asOf,
          right: sql`excluded.right`,
          strike: sql`excluded.strike`,
          expiry: sql`excluded.expiry`,
          average: sql`excluded.average`,
          close: sql`excluded.close`,
          trades: sql`excluded.trades`,
          tradedQuantity: sql`excluded.traded_quantity`,
        },
      });
  }

  return deduped.length;
}

function hasTrades(row: CotahistOptionRow): boolean {
  // ADR-0004: a series with no trades that day produces no fill; COTAHIST
  // repeats the last quoted price with zero trades, which would otherwise
  // look like a real fill.
  return row.trades > 0;
}
