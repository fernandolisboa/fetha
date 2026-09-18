import { and, asc, desc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { optionDailyPrices, optionSeries, tradingSessions } from "../schema";

import type { InstrumentOptionSeries } from "../adapters/b3-instruments/schema";
import type { CotahistOptionRow } from "../adapters/cotahist/schema";
import { calendarWindowThroughExpiry } from "./calendar-repository";
import { ensureMonthlyPartition } from "./partitions";

const CHUNK_SIZE = 1000;

// Mirrors `buildOperationMarketView`'s own `CALENDAR_WINDOW_SESSIONS`
// (market-view.ts): the picker must not offer a price the engine itself
// would refuse to load once the same operation is priced a moment later.
const CALENDAR_WINDOW_SESSIONS = 30;

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
          factor: row.factor,
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
          factor: sql`excluded.factor`,
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

export interface ChainSeries {
  ticker: string;
  right: string;
  strike: string;
  expiry: string;
  style: string;
  lastPrice: { value: string; session: string } | null;
}

// The closing chain for one underlying (UBIQUITOUS_LANGUAGE.md "closing
// chain"): the builder's per-leg instrument picker. B3 reuses option
// tickers across listing cycles (ADR-0017), so this is restricted to
// series that have not yet expired and are visible as of `at`, collapsed
// to the latest `as_of` per ticker — otherwise a picker entry could
// resolve to an expired cycle's strike. A series expiring on
// `currentSession` itself drops out of the picker once that session's own
// close has passed (an inner join on its trading session), rather than
// staying selectable into the evening and pricing at t = 0 with null
// greeks (PR #76 round 2 item 8). Ordered by expiry then strike so a
// call/put ladder reads the way a chain does on paper.
//
// `lastPrice` is the same latest-visible-session row `resolveLegMarketPrice`
// would read (close, falling back to average), bounded by the same
// calendar-window floor as `buildOperationMarketView`: a series can be
// listed and still never have traded, or its only trade can sit outside the
// window, in which case this is `null` and the picker can tell the user the
// series is unpriceable before they pick it (round 2 diagnosis, PETR4 chain
// vs `option_daily_prices`).
export async function optionChainForUnderlying(
  db: Database,
  underlying: string,
  currentSession: string,
  at: Date,
): Promise<ChainSeries[]> {
  const [rows, pastCalendarRows] = await Promise.all([
    db
      .select({
        ticker: optionSeries.ticker,
        right: optionSeries.right,
        strike: optionSeries.strike,
        expiry: optionSeries.expiry,
        style: optionSeries.style,
        asOf: optionSeries.asOf,
      })
      .from(optionSeries)
      .innerJoin(tradingSessions, eq(tradingSessions.date, optionSeries.expiry))
      .where(
        and(
          eq(optionSeries.underlying, underlying),
          gte(optionSeries.expiry, currentSession),
          lte(optionSeries.asOf, at),
          gt(tradingSessions.close, at),
        ),
      ),
    calendarWindowThroughExpiry(db, at, CALENDAR_WINDOW_SESSIONS, null),
  ]);
  const calendarFloor = pastCalendarRows[0]?.date;

  const latestByTicker = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = latestByTicker.get(row.ticker);
    if (!existing || row.asOf > existing.asOf) {
      latestByTicker.set(row.ticker, row);
    }
  }

  const series = [...latestByTicker.values()];
  const tickers = series.map((row) => row.ticker);

  const priceRows =
    tickers.length === 0
      ? []
      : await db
          .selectDistinctOn([optionDailyPrices.ticker], {
            ticker: optionDailyPrices.ticker,
            session: optionDailyPrices.session,
            expiry: optionDailyPrices.expiry,
            strike: optionDailyPrices.strike,
            average: optionDailyPrices.average,
            close: optionDailyPrices.close,
          })
          .from(optionDailyPrices)
          .where(
            and(
              inArray(optionDailyPrices.ticker, tickers),
              lte(optionDailyPrices.asOf, at),
              ...(calendarFloor ? [gte(optionDailyPrices.session, calendarFloor)] : []),
            ),
          )
          .orderBy(asc(optionDailyPrices.ticker), desc(optionDailyPrices.session));

  const latestPriceByTicker = new Map<string, (typeof priceRows)[number]>();
  for (const row of priceRows) {
    latestPriceByTicker.set(row.ticker, row);
  }

  return series
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(a.strike) - Number(b.strike))
    .map(({ ticker, right, strike, expiry, style }) => {
      const priceRow = latestPriceByTicker.get(ticker);
      // A price row from a listing cycle the ticker has since moved past
      // (ADR-0017) must not surface as this cycle's last price.
      const matchesCurrentCycle =
        priceRow && priceRow.expiry === expiry && priceRow.strike === strike;
      const value = matchesCurrentCycle ? (priceRow.close ?? priceRow.average) : null;
      return {
        ticker,
        right,
        strike,
        expiry,
        style,
        lastPrice: matchesCurrentCycle && value ? { value, session: priceRow.session } : null,
      };
    });
}
