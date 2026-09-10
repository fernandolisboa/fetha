import { and, asc, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { candles } from "@/db/schema/market-data";

import type { CotahistStockRow } from "../adapters/cotahist/schema";
import { ensureMonthlyPartition } from "./partitions";

// The storage-side timeframe literal `candles` rows are keyed by; distinct
// from the engine's own `"D1"` domain concept a `MarketView.candles[]` row
// carries (ADR-0013), which every reader maps to regardless of this value.
export const DAILY_TIMEFRAME = "1d";
const CHUNK_SIZE = 1000;

export interface CandleRow {
  ticker: Ticker;
  session: SessionDate;
  asOf: Date;
  open: DecimalString;
  high: DecimalString;
  low: DecimalString;
  close: DecimalString;
  tradedQuantity: number;
}

export interface InstrumentSearchResult {
  ticker: Ticker;
  session: SessionDate;
  close: DecimalString;
}

interface RawCandleRow {
  ticker: string;
  session: string;
  asOf: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  tradedQuantity: number;
}

// The repository is the one edge storage-shaped rows cross (CLAUDE.md
// "validation at the edges"): every caller downstream gets `Ticker`,
// `SessionDate` and `DecimalString`, never a raw `string` to re-parse.
function toCandleRow(row: RawCandleRow): CandleRow {
  return {
    ticker: tickerSchema.parse(row.ticker),
    session: sessionDateSchema.parse(row.session),
    asOf: row.asOf,
    open: decimalStringSchema.parse(row.open),
    high: decimalStringSchema.parse(row.high),
    low: decimalStringSchema.parse(row.low),
    close: decimalStringSchema.parse(row.close),
    tradedQuantity: row.tradedQuantity,
  };
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
  return row ? toCandleRow(row) : null;
}

// Reference data only (ADR-0017): no per-user scope. `SEARCH_PATTERN` only
// accepts a plain alphanumeric prefix so the caller's query can never carry
// a live `ILIKE` wildcard (`%`, `_`, `\`) into the pattern built below.
// `DISTINCT ON` collapses "match + latest close per ticker" into the one
// query a search-as-you-type call (the instrument combobox, #13) needs,
// instead of a follow-up round trip per match.
const SEARCH_PATTERN = /^[A-Za-z0-9]{1,12}$/;

export async function searchInstruments(
  db: Database,
  query: string,
  limit: number,
): Promise<InstrumentSearchResult[]> {
  const trimmed = query.trim();
  if (!SEARCH_PATTERN.test(trimmed)) {
    return [];
  }
  const pattern = `${trimmed}%`;
  const rows = await db
    .selectDistinctOn([candles.ticker], {
      ticker: candles.ticker,
      session: candles.session,
      close: candles.close,
    })
    .from(candles)
    .where(and(eq(candles.timeframe, DAILY_TIMEFRAME), ilike(candles.ticker, pattern)))
    .orderBy(asc(candles.ticker), desc(candles.session))
    .limit(limit);

  return rows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    session: sessionDateSchema.parse(row.session),
    close: decimalStringSchema.parse(row.close),
  }));
}

// Every daily candle for `ticker` between two sessions, inclusive, oldest
// first: the shape a backtest's MarketView needs for its whole warmup-to-
// period-end span (CONTEXT.md "Backtest run"), unlike recentDailyCandles's
// fixed session count for a chart.
export async function candlesForPeriod(
  db: Database,
  ticker: string,
  from: string,
  to: string,
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
    .where(
      and(
        eq(candles.ticker, ticker),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        gte(candles.session, from),
        lte(candles.session, to),
      ),
    )
    .orderBy(asc(candles.session));
  return rows.map(toCandleRow);
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
  return rows.reverse().map(toCandleRow);
}
