import { asc, desc, eq, sql } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  type DecimalString,
  type SessionDate,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { exchangeRates } from "../schema";

import type { ExchangeRatePair, ExchangeRatePoint } from "../adapters/bacen-sgs/schema";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export interface ExchangeRateRow {
  pair: ExchangeRatePair;
  date: SessionDate;
  asOf: Date;
  rate: DecimalString;
}

function toExchangeRateRow(row: {
  pair: string;
  date: string;
  asOf: Date;
  rate: string;
}): ExchangeRateRow {
  return {
    pair: row.pair as ExchangeRatePair,
    date: sessionDateSchema.parse(row.date),
    asOf: row.asOf,
    rate: decimalStringSchema.parse(row.rate),
  };
}

export async function latestExchangeRateDate(
  db: Database,
  pair: ExchangeRatePair,
): Promise<string | undefined> {
  const [row] = await db
    .select({ date: exchangeRates.date })
    .from(exchangeRates)
    .where(eq(exchangeRates.pair, pair))
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  return row?.date;
}

export async function latestExchangeRate(
  db: Database,
  pair: ExchangeRatePair,
): Promise<ExchangeRateRow | undefined> {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.pair, pair))
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  return row ? toExchangeRateRow(row) : undefined;
}

export async function exchangeRateSeries(
  db: Database,
  pair: ExchangeRatePair,
): Promise<ExchangeRateRow[]> {
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.pair, pair))
    .orderBy(asc(exchangeRates.date));
  return rows.map(toExchangeRateRow);
}

export async function upsertExchangeRates(
  db: Database,
  rows: ExchangeRatePoint[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const byKey = new Map<string, ExchangeRatePoint>();
  for (const row of rows) {
    byKey.set(`${row.pair}:${row.date}`, row);
  }
  const deduped = [...byKey.values()];

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(exchangeRates)
      .values(
        batch.map((row) => ({
          pair: row.pair,
          date: row.date,
          asOf: new Date(row.asOf),
          rate: row.rate,
        })),
      )
      .onConflictDoUpdate({
        target: [exchangeRates.pair, exchangeRates.date],
        set: {
          asOf: sql`excluded.as_of`,
          rate: sql`excluded.rate`,
        },
      });
  }

  return deduped.length;
}
