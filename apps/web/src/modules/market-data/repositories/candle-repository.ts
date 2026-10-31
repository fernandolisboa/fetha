import { and, asc, desc, eq, gte, inArray, like, lte, max, min, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerPrefixQuerySchema,
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { candles } from "../schema";

import type { CotahistStockRow } from "../adapters/cotahist/schema";
import type { IndexClosePoint } from "../adapters/b3-indexes/schema";
import { marketIndexTickersForQuery } from "../market-index";
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

// A market index's level, O=H=L=C and zero traded quantity (ADR-0062): the four
// equal prices are a close repeated, not fabricated highs and lows, and nothing that reads
// `high`, `low` or `tradedQuantity` ever sees this row (indexes never enter an evaluated
// universe). One batch of `upsertIndexCandles` can span more than one calendar month (the first
// backfill brings in 2024..today in one call), so every distinct month is partitioned first.
export async function upsertIndexCandles(
  db: Database,
  rows: IndexClosePoint[],
  ticker: Ticker,
  asOfBySession: Map<string, Date>,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const months = new Set(rows.map((row) => row.date.slice(0, 7)));
  for (const month of months) {
    await ensureMonthlyPartition(db, "candles", `${month}-01`);
  }

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    await db
      .insert(candles)
      .values(
        batch.map((row) => {
          const asOf = asOfBySession.get(row.date);
          if (!asOf) {
            throw new Error(`no asOf instant resolved for index session ${row.date}`);
          }
          return {
            ticker,
            timeframe: DAILY_TIMEFRAME,
            session: row.date,
            asOf,
            open: row.close,
            high: row.close,
            low: row.close,
            close: row.close,
            tradedQuantity: 0,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [candles.ticker, candles.timeframe, candles.session],
        set: {
          asOf: sql`excluded.as_of`,
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          tradedQuantity: sql`excluded.traded_quantity`,
        },
      });
  }

  return rows.length;
}

// Every daily candle for `tickers` whose session falls in [fromSession,
// toSession], oldest first: the shape a `DataWindow`-driven MarketView
// needs (#19), driven by session dates rather than a row-count limit so a
// strategy's own indicator warm-up decides how far back to load, not a
// fixed constant.
export async function candlesInSessionRange(
  db: Database,
  tickers: string[],
  fromSession: string,
  toSession: string,
): Promise<CandleRow[]> {
  if (tickers.length === 0) {
    return [];
  }
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
        inArray(candles.ticker, tickers),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        gte(candles.session, fromSession),
        lte(candles.session, toSession),
      ),
    )
    .orderBy(asc(candles.ticker), asc(candles.session));
  return rows.map(toCandleRow);
}

// Every daily candle for `tickers` visible at or before `at`, latest session first, capped at
// `limit`: `buildOperationMarketView`'s own trailing window, shared by the single-ticker
// underlying query and the multi-ticker `extraInstruments` one, which only ever differed in
// `tickers` and `limit`.
export async function candlesAtOrBefore(
  db: Database,
  tickers: readonly string[],
  at: Date,
  limit: number,
): Promise<CandleRow[]> {
  if (tickers.length === 0) {
    return [];
  }
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
        inArray(candles.ticker, [...tickers]),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        lte(candles.asOf, at),
      ),
    )
    .orderBy(desc(candles.session))
    .limit(limit);
  return rows.map(toCandleRow);
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

// The last `limit` daily closes of each of `tickers`, oldest first, in one round trip: a lateral
// probe per ticker rides the `(ticker, timeframe, session)` primary key, so a watchlist of a
// hundred tickers reads a hundred short index ranges, not their whole history. A ticker with no
// candle has no entry in the map.
export async function recentDailyCloses(
  db: Database,
  tickers: readonly string[],
  limit: number,
): Promise<Map<string, DecimalString[]>> {
  const closesByTicker = new Map<string, DecimalString[]>();
  if (tickers.length === 0) {
    return closesByTicker;
  }
  const wanted = sql.join(
    tickers.map((ticker) => sql`${ticker}`),
    sql`, `,
  );
  const result = await db.execute<{ ticker: string; close: string }>(sql`
    select wanted.ticker, recent.close::text as close
    from unnest(array[${wanted}]::text[]) as wanted(ticker)
    cross join lateral (
      select ${candles.session} as session, ${candles.close} as close
      from ${candles}
      where ${candles.ticker} = wanted.ticker and ${candles.timeframe} = ${DAILY_TIMEFRAME}
      order by ${candles.session} desc
      limit ${limit}
    ) as recent
    order by wanted.ticker, recent.session asc
  `);
  for (const row of result.rows) {
    const closes = closesByTicker.get(row.ticker) ?? [];
    closes.push(decimalStringSchema.parse(row.close));
    closesByTicker.set(row.ticker, closes);
  }
  return closesByTicker;
}

// Reference data only (ADR-0017): no per-user scope. `tickerPrefixQuerySchema`
// keeps live `LIKE` wildcards out of the pattern built below. `DISTINCT ON` collapses "match + latest close per ticker" into the one
// query a search-as-you-type call (the instrument combobox, #13) needs,
// instead of a follow-up round trip per match. Tickers are stored uppercase
// (`tickerSchema`, @fetha/contracts), so the query is uppercased here and
// matched with a plain `LIKE` prefix, which the `candles (ticker
// text_pattern_ops)` index (#74) can actually use; `ILIKE` cannot.

export async function searchInstruments(
  db: Database,
  query: string,
  limit: number,
): Promise<InstrumentSearchResult[]> {
  const trimmed = query.trim();
  if (!tickerPrefixQuerySchema.safeParse(trimmed).success) {
    return [];
  }
  const pattern = `${trimmed.toUpperCase()}%`;
  // "ibovespa" is not itself a prefix of `IBOV11`, so the alias match is added to the `LIKE`
  // prefix match rather than replacing it (ADR-0062): "ibov" already hits
  // `IBOV11` by prefix alone and must not also hit it through the alias clause, which
  // `marketIndexTickersForQuery` never duplicates since it returns each index ticker at most
  // once. `inArray([])` would still work, but the clause is only added once it has a ticker
  // to add, so the `text_pattern_ops` index keeps serving the plain `LIKE` on its own.
  const aliasTickers = marketIndexTickersForQuery(trimmed);
  const matcher =
    aliasTickers.length > 0
      ? or(like(candles.ticker, pattern), inArray(candles.ticker, aliasTickers))
      : like(candles.ticker, pattern);
  const rows = await db
    .selectDistinctOn([candles.ticker], {
      ticker: candles.ticker,
      session: candles.session,
      close: candles.close,
    })
    .from(candles)
    .where(and(eq(candles.timeframe, DAILY_TIMEFRAME), matcher))
    .orderBy(asc(candles.ticker), desc(candles.session))
    .limit(limit);

  return rows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    session: sessionDateSchema.parse(row.session),
    close: decimalStringSchema.parse(row.close),
  }));
}

// The first and last ingested candle session, across the whole universe,
// inside `period` — never a whole-period load: the creation-time refusal
// for a `from` the calendar carries but that has no ingested candle for
// any ticker in the universe used to answer this with
// `loadMarketView(...).candles.length === 0`, the same whole-period
// MarketView materialisation `run-chunk.ts` needs a 300-second route budget
// for — paid in a Server Action with no raised duration at all. Also the
// data-clamp for the run's own `period` (#18): the ANBIMA calendar is
// ingested from `FIRST_INGESTED_CALENDAR_YEAR` while COTAHIST candle
// history starts whenever this app first ingested a session, and
// back-fills only `RECENT_SESSION_WINDOW` sessions on top of that — both
// far narrower than the calendar's own reach on *either* end. Clamping
// only `to` left `from` exactly as exposed: a `from` before candle history begins
// still passes the calendar check and buys hundreds of candle-less equity
// points with no note, diluting CAGR, Sharpe and exposure on an immutable
// run. One `MIN()`/`MAX()` aggregate query against the `(ticker, timeframe,
// session)` index gives existence and both clamps together. Deliberately the
// union across `universe`, not an intersection per ticker: bounding to the
// range every ticker already has data for would silently shrink a run's
// period whenever one watchlist ticker listed later than the rest, with no
// way for the user to tell a short history from a short request. Any
// resulting interior gap — a ticker with no candle on a session inside this
// union range — is the engine's problem now, not this clamp's: ADR-0041
// excludes a candle-less session from `metrics.sessions` (and notes the
// count) rather than letting it dilute the run.
export async function candleSessionBoundsInRange(
  db: Database,
  universe: string[],
  period: { from: string; to: string },
): Promise<{ first: string; last: string } | undefined> {
  if (universe.length === 0) {
    return undefined;
  }
  const [row] = await db
    .select({ first: min(candles.session), last: max(candles.session) })
    .from(candles)
    .where(
      and(
        inArray(candles.ticker, universe),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        gte(candles.session, period.from),
        lte(candles.session, period.to),
      ),
    );
  if (!row?.first || !row.last) {
    return undefined;
  }
  return { first: row.first, last: row.last };
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
