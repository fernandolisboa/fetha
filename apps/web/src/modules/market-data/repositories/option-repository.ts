import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import type { InstrumentOptionSeries } from "../adapters/b3-instruments/schema";
import type { CotahistOptionRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

export async function upsertOptionSeries(
  db: Database,
  asOf: Date,
  rows: InstrumentOptionSeries[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(optionSeries)
    .values(
      rows.map((row) => ({
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
      target: optionSeries.ticker,
      set: {
        underlying: sql`excluded.underlying`,
        right: sql`excluded.right`,
        strike: sql`excluded.strike`,
        expiry: sql`excluded.expiry`,
        style: sql`excluded.style`,
        asOf,
      },
    });

  return rows.length;
}

export async function upsertOptionDailyPrices(
  db: Database,
  session: string,
  asOf: Date,
  rows: CotahistOptionRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  await ensureMonthlyPartition(db, "option_daily_prices", session);

  await db
    .insert(optionDailyPrices)
    .values(
      rows.map((row) => ({
        ticker: row.ticker,
        session: row.session,
        asOf,
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
        average: sql`excluded.average`,
        close: sql`excluded.close`,
        trades: sql`excluded.trades`,
        tradedQuantity: sql`excluded.traded_quantity`,
      },
    });

  return rows.length;
}

function hasTrades(row: CotahistOptionRow): boolean {
  // ADR-0004: a series with no trades that day produces no fill; COTAHIST
  // repeats the last quoted price with zero trades, which would otherwise
  // look like a real fill.
  return row.trades > 0;
}
