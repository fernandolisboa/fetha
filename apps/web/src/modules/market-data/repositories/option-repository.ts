import Decimal from "decimal.js";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  like,
  lt,
  lte,
  min,
  sql,
} from "drizzle-orm";
import {
  decimalStringSchema,
  exerciseStyleSchema,
  optionRightSchema,
  sessionDateSchema,
  tickerPrefixQuerySchema,
  tickerSchema,
  type DecimalString,
  type ExerciseStyle,
  type OptionRight,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import {
  candles,
  optionDailyPrices,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "../schema";

import type { InstrumentOptionSeries } from "../adapters/b3-instruments/schema";
import type { CotahistOptionRow } from "../adapters/cotahist/schema";
import { calendarWindowThroughExpiry } from "./calendar-repository";
import { DAILY_TIMEFRAME } from "./candle-repository";
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

interface StrikeEpoch {
  ticker: string;
  expiry: string;
  right: string;
  strike: string;
  asOf: Date;
}

// The registry parser passes strikes through unnormalized ("340", "100,39"
// pre-parse): two ISINs on the same (ticker, expiry, right) whose strikes
// differ only textually ("14.98" vs "14.980") are the same numeric column
// value and the same conflict target, so the key must normalize or a batch
// insert hits that target twice and Postgres refuses ("ON CONFLICT DO UPDATE
// command cannot affect row a second time").
function strikeEpochKey(epoch: StrikeEpoch): string {
  return `${epoch.ticker}|${epoch.expiry}|${epoch.right}|${new Decimal(epoch.strike).toFixed(8)}`;
}

// `as_of` moves only backward on conflict (`LEAST`) — the same monotonic
// rule ADR-0017 uses for `option_series.as_of` itself, so a re-ingested
// older snapshot can never erase a newer epoch a later run already recorded.
async function upsertStrikeEpochs(db: Database, epochs: StrikeEpoch[]): Promise<void> {
  const deduped = dedupeByKey(epochs, strikeEpochKey);
  if (deduped.length === 0) {
    return;
  }
  // Sorted so two overlapping ingestion runs take Postgres row locks in the
  // same order, the same deadlock-avoidance a batched upsert always needs
  // once it can touch more than one row of the same target.
  deduped.sort((a, b) => strikeEpochKey(a).localeCompare(strikeEpochKey(b)));
  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(optionSeriesStrikes)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          optionSeriesStrikes.ticker,
          optionSeriesStrikes.expiry,
          optionSeriesStrikes.right,
          optionSeriesStrikes.strike,
        ],
        set: {
          asOf: sql`least(${optionSeriesStrikes.asOf}, excluded.as_of)`,
        },
        setWhere: sql`${optionSeriesStrikes.asOf} > excluded.as_of`,
      });
  }
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

  await upsertStrikeEpochs(
    db,
    deduped.map((row) => ({
      ticker: row.ticker,
      expiry: row.expiry,
      right: row.right,
      strike: row.strike,
      asOf,
    })),
  );

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

  await upsertStrikeEpochs(
    db,
    deduped.map((row) => ({
      ticker: row.ticker,
      expiry: row.expiry,
      right: row.right,
      strike: row.strike,
      asOf,
    })),
  );

  return deduped.length;
}

function hasTrades(row: CotahistOptionRow): boolean {
  // ADR-0004: a series with no trades that day produces no fill; COTAHIST
  // repeats the last quoted price with zero trades, which would otherwise
  // look like a real fill.
  return row.trades > 0;
}

// Resolves each option ticker's expiry from the series registry, keeping
// the most recently registered listing cycle per ticker (B3 reuses option
// tickers across cycles, ADR-0017) the same way `optionChainForUnderlying`'s
// own `latestByTicker` dedupe does. Good enough for a horizon default (the
// decisions module's own use, `resolve-default-horizon.ts`): the user can
// always override the prefilled date, so a reused-ticker edge case here
// costs at most a wrong prefill, never a wrong stored decision.
export async function expiryByTicker(
  db: Database,
  tickers: string[],
): Promise<Map<string, string>> {
  if (tickers.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([optionSeries.ticker], {
      ticker: optionSeries.ticker,
      expiry: optionSeries.expiry,
    })
    .from(optionSeries)
    .where(inArray(optionSeries.ticker, tickers))
    .orderBy(asc(optionSeries.ticker), desc(optionSeries.asOf));

  return new Map(rows.map((row) => [row.ticker, row.expiry]));
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
// greeks. Ordered by expiry then strike so a
// call/put ladder reads the way a chain does on paper.
//
// `lastPrice` is the same latest-visible-session row `resolveLegMarketPrice`
// would read (close, falling back to average), bounded by the same
// calendar-window floor as `buildOperationMarketView`: a series can be
// listed and still never have traded, or its only trade can sit outside the
// window, in which case this is `null` and the picker can tell the user the
// series is unpriceable before they pick it (PETR4 chain vs `option_daily_prices`).

// Epochs sorted ascending by `asOf` for one `(ticker, expiry, right)` cycle: the strike visible
// at `instant` is the last one whose own `asOf` has not yet arrived, falling back to the
// series' current strike for a cycle with no epoch rows (a write predating migration 0033).
function strikeVisibleAt(
  epochs: readonly { strike: string; asOf: Date }[],
  instant: Date,
  fallback: string,
): string {
  let visible = fallback;
  for (const epoch of epochs) {
    if (epoch.asOf > instant) {
      break;
    }
    visible = epoch.strike;
  }
  return visible;
}

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

  const [priceRows, epochRows] = await Promise.all([
    tickers.length === 0
      ? []
      : db
          .selectDistinctOn([optionDailyPrices.ticker], {
            ticker: optionDailyPrices.ticker,
            session: optionDailyPrices.session,
            expiry: optionDailyPrices.expiry,
            strike: optionDailyPrices.strike,
            average: optionDailyPrices.average,
            close: optionDailyPrices.close,
            asOf: optionDailyPrices.asOf,
          })
          .from(optionDailyPrices)
          .where(
            and(
              inArray(optionDailyPrices.ticker, tickers),
              lte(optionDailyPrices.asOf, at),
              ...(calendarFloor ? [gte(optionDailyPrices.session, calendarFloor)] : []),
            ),
          )
          .orderBy(asc(optionDailyPrices.ticker), desc(optionDailyPrices.session)),
    tickers.length === 0
      ? []
      : db
          .select({
            ticker: optionSeriesStrikes.ticker,
            expiry: optionSeriesStrikes.expiry,
            right: optionSeriesStrikes.right,
            strike: optionSeriesStrikes.strike,
            asOf: optionSeriesStrikes.asOf,
          })
          .from(optionSeriesStrikes)
          .where(inArray(optionSeriesStrikes.ticker, tickers))
          .orderBy(asc(optionSeriesStrikes.asOf)),
  ]);

  const latestPriceByTicker = new Map<string, (typeof priceRows)[number]>();
  for (const row of priceRows) {
    latestPriceByTicker.set(row.ticker, row);
  }

  const epochsByCycle = new Map<string, { strike: string; asOf: Date }[]>();
  for (const row of epochRows) {
    const key = `${row.ticker}|${row.expiry}|${row.right}`;
    const epochs = epochsByCycle.get(key);
    if (epochs) {
      epochs.push({ strike: row.strike, asOf: row.asOf });
    } else {
      epochsByCycle.set(key, [{ strike: row.strike, asOf: row.asOf }]);
    }
  }

  return series
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || Number(a.strike) - Number(b.strike))
    .map(({ ticker, right, strike, expiry, style }) => {
      const priceRow = latestPriceByTicker.get(ticker);
      // A price row from a listing cycle the ticker has since moved past
      // (ADR-0017) must not surface as this cycle's last price. Within the
      // current cycle, the price's own strike is compared against the strike
      // epoch visible at the price row's own `asOf` (ADR-0056), not the
      // ticker's current registry strike: on a session where the registry
      // and COTAHIST briefly disagree about the strike, the price's own
      // instant still resolves to the strike it was actually recorded under.
      const epochs = priceRow
        ? (epochsByCycle.get(`${ticker}|${priceRow.expiry}|${right}`) ?? [])
        : [];
      const visibleStrike = priceRow ? strikeVisibleAt(epochs, priceRow.asOf, strike) : null;
      const matchesCurrentCycle =
        priceRow && priceRow.expiry === expiry && priceRow.strike === visibleStrike;
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

export interface OptionSeriesSearchResult {
  ticker: Ticker;
  underlying: Ticker;
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
}

// Prefix search over the series registry for the Ctrl K palette (#241),
// served by the `option_series (ticker text_pattern_ops)` index. Only cycles still alive on `today`, and one row per ticker because B3
// reuses option tickers across cycles (ADR-0017): the nearest live cycle,
// the latest registry snapshot winning a tie, which is the same cycle
// `optionSeriesDetail` opens for that ticker.
export async function searchOptionSeries(
  db: Database,
  query: string,
  today: SessionDate,
  limit: number,
): Promise<OptionSeriesSearchResult[]> {
  const trimmed = query.trim();
  if (!tickerPrefixQuerySchema.safeParse(trimmed).success) {
    return [];
  }
  const rows = await db
    .selectDistinctOn([optionSeries.ticker], {
      ticker: optionSeries.ticker,
      underlying: optionSeries.underlying,
      right: optionSeries.right,
      strike: optionSeries.strike,
      expiry: optionSeries.expiry,
    })
    .from(optionSeries)
    .where(
      and(like(optionSeries.ticker, `${trimmed.toUpperCase()}%`), gte(optionSeries.expiry, today)),
    )
    .orderBy(asc(optionSeries.ticker), asc(optionSeries.expiry), desc(optionSeries.asOf))
    .limit(limit);

  return rows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    underlying: tickerSchema.parse(row.underlying),
    right: optionRightSchema.parse(row.right),
    strike: decimalStringSchema.parse(row.strike),
    expiry: sessionDateSchema.parse(row.expiry),
  }));
}

export interface OptionSeriesPrice {
  session: SessionDate;
  close: DecimalString | null;
  average: DecimalString | null;
  trades: number;
}

export interface OptionSeriesDetail extends OptionSeriesSearchResult {
  style: ExerciseStyle;
  expired: boolean;
  lastTrade: { session: SessionDate; close: DecimalString } | null;
  prices: OptionSeriesPrice[];
}

// The cycle a series page shows for `ticker`: the one `searchOptionSeries`
// lists while any cycle is alive, else the most recently expired one, so a
// bookmarked page for a past series still resolves. Prices are that cycle's
// own rows only (same ticker and expiry), newest first: a reused ticker's
// earlier cycle must not show up in its history (ADR-0017).
export async function optionSeriesDetail(
  db: Database,
  ticker: Ticker,
  today: SessionDate,
  priceLimit: number,
): Promise<OptionSeriesDetail | null> {
  const cycles = await db
    .select({
      ticker: optionSeries.ticker,
      underlying: optionSeries.underlying,
      right: optionSeries.right,
      strike: optionSeries.strike,
      expiry: optionSeries.expiry,
      style: optionSeries.style,
    })
    .from(optionSeries)
    .where(eq(optionSeries.ticker, ticker))
    .orderBy(asc(optionSeries.expiry), desc(optionSeries.asOf));

  const live = cycles.find((cycle) => cycle.expiry >= today);
  const latestExpiry = cycles.at(-1)?.expiry;
  const cycle = live ?? cycles.find((candidate) => candidate.expiry === latestExpiry);
  if (!cycle) {
    return null;
  }

  const sameCycle = and(
    eq(optionDailyPrices.ticker, ticker),
    eq(optionDailyPrices.expiry, cycle.expiry),
  );
  const [priceRows, [lastTradeRow]] = await Promise.all([
    db
      .select({
        session: optionDailyPrices.session,
        close: optionDailyPrices.close,
        average: optionDailyPrices.average,
        trades: optionDailyPrices.trades,
      })
      .from(optionDailyPrices)
      .where(sameCycle)
      .orderBy(desc(optionDailyPrices.session))
      .limit(priceLimit),
    db
      .select({ session: optionDailyPrices.session, close: optionDailyPrices.close })
      .from(optionDailyPrices)
      .where(and(sameCycle, isNotNull(optionDailyPrices.close)))
      .orderBy(desc(optionDailyPrices.session))
      .limit(1),
  ]);

  return {
    ticker: tickerSchema.parse(cycle.ticker),
    underlying: tickerSchema.parse(cycle.underlying),
    right: optionRightSchema.parse(cycle.right),
    strike: decimalStringSchema.parse(cycle.strike),
    expiry: sessionDateSchema.parse(cycle.expiry),
    style: exerciseStyleSchema.parse(cycle.style),
    expired: live === undefined,
    lastTrade:
      lastTradeRow?.close == null
        ? null
        : {
            session: sessionDateSchema.parse(lastTradeRow.session),
            close: decimalStringSchema.parse(lastTradeRow.close),
          },
    prices: priceRows.map((row) => ({
      session: sessionDateSchema.parse(row.session),
      close: row.close === null ? null : decimalStringSchema.parse(row.close),
      average: row.average === null ? null : decimalStringSchema.parse(row.average),
      trades: row.trades,
    })),
  };
}

export interface ResolvedOptionSeries {
  ticker: string;
  underlying: string;
  right: string;
  strike: string;
  expiry: string;
}

export function seriesKey(ticker: string, session: string): string {
  return `${ticker}|${session}`;
}

// The series a fill in `ticker` on `session` traded: B3 reuses option
// tickers across listing cycles (ADR-0017), so it is the earliest listed
// expiry on or after that session, the latest registry snapshot winning a
// tie, among cycles already listed by then (first seen in the registry or
// first traded on or before the session). Keyed by `seriesKey`; a pair with
// no such series is absent.
export async function optionSeriesForFills(
  db: Database,
  fills: readonly { ticker: string; session: string }[],
): Promise<Map<string, ResolvedOptionSeries>> {
  const tickers = [...new Set(fills.map((fill) => fill.ticker))];
  if (tickers.length === 0) {
    return new Map();
  }
  const [rows, firstTrades] = await Promise.all([
    db
      .select({
        ticker: optionSeries.ticker,
        underlying: optionSeries.underlying,
        right: optionSeries.right,
        strike: optionSeries.strike,
        expiry: optionSeries.expiry,
        asOf: optionSeries.asOf,
      })
      .from(optionSeries)
      .where(inArray(optionSeries.ticker, tickers))
      .orderBy(asc(optionSeries.expiry), desc(optionSeries.asOf)),
    db
      .select({
        ticker: optionDailyPrices.ticker,
        expiry: optionDailyPrices.expiry,
        first: min(optionDailyPrices.session),
      })
      .from(optionDailyPrices)
      .where(inArray(optionDailyPrices.ticker, tickers))
      .groupBy(optionDailyPrices.ticker, optionDailyPrices.expiry),
  ]);
  const firstTraded = new Map(
    firstTrades.map((trade) => [`${trade.ticker}|${trade.expiry}`, trade.first]),
  );

  const resolved = new Map<string, ResolvedOptionSeries>();
  for (const fill of fills) {
    const match = rows.find((row) => {
      if (row.ticker !== fill.ticker || row.expiry < fill.session) {
        return false;
      }
      const listed = row.asOf.toISOString().slice(0, 10);
      const traded = firstTraded.get(`${row.ticker}|${row.expiry}`);
      return listed <= fill.session || (traded != null && traded <= fill.session);
    });
    if (match) {
      resolved.set(seriesKey(fill.ticker, fill.session), {
        ticker: match.ticker,
        underlying: match.underlying,
        right: match.right,
        strike: match.strike,
        expiry: match.expiry,
      });
    }
  }
  return resolved;
}

export interface ExpiredTradedSeries {
  ticker: string;
  session: string;
  expiry: string;
  close: string;
}

// E2E fixture lookup: the most recently expired series of `underlying` that
// traded before its expiry, restricted to expiries whose underlying close is
// ingested so a settlement proposal can be built for it.
export async function latestExpiredTradedSeries(
  db: Database,
  underlying: string,
): Promise<ExpiredTradedSeries | null> {
  const [row] = await db
    .select({
      ticker: optionDailyPrices.ticker,
      session: optionDailyPrices.session,
      expiry: optionDailyPrices.expiry,
      close: optionDailyPrices.close,
    })
    .from(optionDailyPrices)
    .innerJoin(
      optionSeries,
      and(
        eq(optionSeries.ticker, optionDailyPrices.ticker),
        eq(optionSeries.expiry, optionDailyPrices.expiry),
      ),
    )
    .innerJoin(
      candles,
      and(
        eq(candles.ticker, optionSeries.underlying),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        eq(candles.session, optionDailyPrices.expiry),
      ),
    )
    .where(
      and(
        eq(optionSeries.underlying, underlying),
        lt(optionDailyPrices.session, optionDailyPrices.expiry),
        isNotNull(optionDailyPrices.close),
      ),
    )
    .orderBy(desc(optionDailyPrices.expiry), desc(optionDailyPrices.session))
    .limit(1);
  if (!row?.close) {
    return null;
  }
  return { ticker: row.ticker, session: row.session, expiry: row.expiry, close: row.close };
}

// `option_series` is keyed by ISIN (ADR-0017): distinct series tickers can
// exceed universe size by an order of magnitude once every listing cycle
// with an expiry on or after warmup is counted, and the create-time ceiling
// (MAX_SESSIONS_TIMES_UNIVERSE, backtests/actions.ts) bounds sessions x
// underlyings, not sessions x series, so it cannot stand in for this. Well
// under Postgres's 65,535 bind-parameter limit, which the follow-on
// `optionDailyPrices` query hits directly via `inArray(..., seriesTickers)`.
export const DEFAULT_OPTION_CHAIN_TICKER_CAP = 20_000;

// Bounds price-row *volume* directly, which DEFAULT_OPTION_CHAIN_TICKER_CAP
// does not: a chain admitted under that cap can still span the whole
// warmup-to-period window, so up to cap x sessions day-price rows would
// otherwise materialise as objects in `loadMarketView`'s call before any
// checkpoint exists to recover from an out-of-memory death. 200,000 rows of
// this shape (a handful of decimal strings and two integers each) is
// comfortably tens of megabytes, not the "millions of row objects" an
// unbounded query could reach.
export const DEFAULT_OPTION_PRICE_ROW_CAP = 200_000;

// Discriminated result for a capped chain query: `rows` never carries the sentinel +1 row a
// caller could otherwise mistake for real data, and every caller switches on `ok` instead of
// re-deriving "over the cap" from `rows.length` itself.
export type CappedQueryResult<Row> = { ok: true; rows: Row[] } | { ok: false; reason: "over_cap" };

function capped<Row>(rows: Row[], cap: number): CappedQueryResult<Row> {
  return rows.length > cap ? { ok: false, reason: "over_cap" } : { ok: true, rows };
}

export interface OptionSeriesEpochRow {
  ticker: string;
  underlying: string;
  right: string;
  strike: string;
  expiry: string;
  style: string;
  asOf: Date;
}

function epochJoin() {
  return and(
    eq(optionSeriesStrikes.ticker, optionSeries.ticker),
    eq(optionSeriesStrikes.expiry, optionSeries.expiry),
    eq(optionSeriesStrikes.right, optionSeries.right),
  );
}

function epochAsOfCondition(asOfCeiling: Date) {
  return sql`coalesce(${optionSeriesStrikes.asOf}, ${optionSeries.asOf}) <= ${asOfCeiling}`;
}

// COALESCEd against `option_series` (ADR-0056) so a series with no epoch row yet
// (a write predating this table, or a gap the backfill did not reach) resolves
// exactly as it did before the table existed.
const epochColumns = {
  ticker: optionSeries.ticker,
  underlying: optionSeries.underlying,
  right: optionSeries.right,
  style: optionSeries.style,
  expiry: optionSeries.expiry,
  strike: sql<string>`coalesce(${optionSeriesStrikes.strike}, ${optionSeries.strike})`.mapWith(
    optionSeries.strike,
  ),
  asOf: sql<Date>`coalesce(${optionSeriesStrikes.asOf}, ${optionSeries.asOf})`.mapWith(
    optionSeries.asOf,
  ),
};

// A strategy's chain window for `loadMarketView`: every epoch of every series listed on an
// underlying in the universe that had not yet expired at `expiryFloor` (the start of warmup),
// with an epoch visible on or before `asOfCeiling` (the engine, not this query, decides
// per-step visibility off each row's own `asOf`, which is why this bounds `asOf` only by the
// window's end). `cap` counts *distinct tickers*, not epoch rows (ADR-0056: one series can now
// contribute more than one row), so it is checked in a first pass before the epoch rows
// materialise, keeping the follow-on price query's `inArray` bind list within Postgres's 65,535
// parameter limit the same way it always has. The epoch rows themselves are not separately
// capped: `DEFAULT_OPTION_CHAIN_TICKER_CAP` tickers times a handful of epochs each is far under
// any volume `DEFAULT_OPTION_PRICE_ROW_CAP` already treats as safe for the heavier follow-on
// price query.
export async function optionSeriesInWindow(
  db: Database,
  underlyings: readonly string[],
  window: { expiryFloor: string; asOfCeiling: Date },
  cap: number,
): Promise<CappedQueryResult<OptionSeriesEpochRow>> {
  const tickerRows = await db
    .selectDistinct({ ticker: optionSeries.ticker })
    .from(optionSeries)
    .leftJoin(optionSeriesStrikes, epochJoin())
    .where(
      and(
        inArray(optionSeries.underlying, [...underlyings]),
        gte(optionSeries.expiry, window.expiryFloor),
        epochAsOfCondition(window.asOfCeiling),
      ),
    )
    .limit(cap + 1);

  if (tickerRows.length > cap) {
    return { ok: false, reason: "over_cap" };
  }
  const tickers = tickerRows.map((row) => row.ticker);
  if (tickers.length === 0) {
    return { ok: true, rows: [] };
  }

  const rows = await db
    .select(epochColumns)
    .from(optionSeries)
    .leftJoin(optionSeriesStrikes, epochJoin())
    .where(
      and(
        inArray(optionSeries.underlying, [...underlyings]),
        inArray(optionSeries.ticker, tickers),
        gte(optionSeries.expiry, window.expiryFloor),
        epochAsOfCondition(window.asOfCeiling),
      ),
    );
  return { ok: true, rows };
}

// Every day price of `tickers` in `[fromSession, toSession]`, querying at most `cap + 1` rows so
// the caller can refuse a price volume over the cap before it materialises in memory, reported as
// `over_cap` rather than the sentinel row itself.
export async function optionPricesInSessionRange(
  db: Database,
  tickers: readonly string[],
  range: { fromSession: string; toSession: string },
  cap: number,
): Promise<CappedQueryResult<typeof optionDailyPrices.$inferSelect>> {
  const rows = await db
    .select()
    .from(optionDailyPrices)
    .where(
      and(
        inArray(optionDailyPrices.ticker, [...tickers]),
        gte(optionDailyPrices.session, range.fromSession),
        lte(optionDailyPrices.session, range.toSession),
      ),
    )
    .limit(cap + 1);
  return capped(rows, cap);
}

// One underlying's chain as `buildOperationMarketView` sees it at `at`, bounded below by the
// calendar floor so it does not accumulate every ticker the underlying has ever listed. One row
// per strike epoch (ADR-0056), not per ticker.
export async function optionSeriesForUnderlyingAt(
  db: Database,
  underlying: string,
  at: Date,
  expiryFloor: string | undefined,
): Promise<OptionSeriesEpochRow[]> {
  return db
    .select(epochColumns)
    .from(optionSeries)
    .leftJoin(optionSeriesStrikes, epochJoin())
    .where(
      and(
        eq(optionSeries.underlying, underlying),
        epochAsOfCondition(at),
        ...(expiryFloor ? [gte(optionSeries.expiry, expiryFloor)] : []),
      ),
    );
}

// The latest day price per ticker visible at `at`, collapsed in SQL and bounded below by the
// same calendar floor as the chain: an option's price history since inception is not needed.
export async function latestOptionPricesAt(
  db: Database,
  tickers: readonly string[],
  at: Date,
  sessionFloor: string | undefined,
): Promise<(typeof optionDailyPrices.$inferSelect)[]> {
  return db
    .selectDistinctOn([optionDailyPrices.ticker])
    .from(optionDailyPrices)
    .where(
      and(
        inArray(optionDailyPrices.ticker, [...tickers]),
        lte(optionDailyPrices.asOf, at),
        ...(sessionFloor ? [gte(optionDailyPrices.session, sessionFloor)] : []),
      ),
    )
    .orderBy(asc(optionDailyPrices.ticker), desc(optionDailyPrices.session));
}
