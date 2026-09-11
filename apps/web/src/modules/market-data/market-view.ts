import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  decimalStringSchema,
  exerciseStyleSchema,
  instantSchema,
  macroSeriesKindSchema,
  optionRightSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type Instant,
  type Ticker,
} from "@fetha/contracts";
import {
  type Candle,
  type CorporateActionFactor,
  type DataWindow,
  type MacroPoint,
  type MarketView,
  type MarketViewCollection,
  type OptionDayPrice,
  type OptionSeries,
  type TradingSession,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import {
  calendarWindowThroughExpiry,
  sessionBefore,
  sessionByDate,
  sessionsInRange,
  sessionsUpTo,
} from "./repositories/calendar-repository";
import {
  candlesInSessionRange,
  DAILY_TIMEFRAME,
  type CandleRow,
} from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";
import { macroPointsInRange } from "./repositories/macro-repository";

const CANDLE_WINDOW_SESSIONS = 30;
const CALENDAR_WINDOW_SESSIONS = 30;

// `option_series` is keyed by ISIN (ADR-0017): distinct series tickers can
// exceed universe size by an order of magnitude once every listing cycle
// with an expiry on or after warmup is counted, and the create-time ceiling
// (MAX_SESSIONS_TIMES_UNIVERSE, backtests/actions.ts) bounds sessions x
// underlyings, not sessions x series, so it cannot stand in for this. Well
// under Postgres's 65,535 bind-parameter limit, which the follow-on
// `optionDailyPrices` query hits directly via `inArray(..., seriesTickers)`
// (round 3 item 2).
const DEFAULT_OPTION_CHAIN_TICKER_CAP = 20_000;

// Bounds price-row *volume* directly, which DEFAULT_OPTION_CHAIN_TICKER_CAP
// does not: a chain admitted under that cap can still span the whole
// warmup-to-period window, so up to cap x sessions day-price rows would
// otherwise materialise as objects in this one function call before any
// checkpoint exists to recover from an out-of-memory death (round 4
// item 3). 200,000 rows of this shape (a handful of decimal strings and
// two integers each) is comfortably tens of megabytes, not the "millions
// of row objects" an unbounded query could reach.
const DEFAULT_OPTION_PRICE_ROW_CAP = 200_000;

// Not "collections this loader can never fill" (round 7 item 4 corrected
// that framing): `dividendYields` and `quotes` are unconditionally empty
// too (no ingestion pipeline for either), and `dividendYields` is in every
// window regardless of strategy, so a maintainer applying "never fills"
// literally would refuse every strategy in the product the moment they
// noticed. The actual rule is narrower: collections whose absence leaves a
// strategy with no way to evaluate at all, as opposed to one that degrades
// gracefully with an explicit note — a missing dividend yield defaults to
// `q = 0` and records `dividend_yield_defaulted`, never blocking
// evaluation, while a missing `impliedVolatilityIndex` (round 2 item 8,
// follow-up #81) leaves an `iv_rank` condition permanently
// `insufficient_data` with nothing to size or compare against.
// `market-data` is the module that knows which collections it can fill —
// it owns the loader — so this is the one place that fact lives, not a
// hardcoded literal re-stated in every caller that needs to refuse a
// strategy up front (`evaluate-signals.ts`, `backtests/actions.ts`; round 6
// item 9 closed the duplication between them).
const UNSATISFIABLE_COLLECTIONS: readonly MarketViewCollection[] = ["impliedVolatilityIndex"];

export function canSatisfyCollection(collection: MarketViewCollection): boolean {
  return !UNSATISFIABLE_COLLECTIONS.includes(collection);
}

function toDecimal(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

export function toTradingSession(row: { date: string; open: Date; close: Date }): TradingSession {
  return {
    date: sessionDateSchema.parse(row.date),
    open: instantSchema.parse(row.open.toISOString()),
    close: instantSchema.parse(row.close.toISOString()),
  };
}

// Thrown instead of an empty-but-typed-as-valid MarketView whenever the
// requested range cannot be resolved into one: no session at all overlaps
// the window (round 2 item 9), or (its own subclass, MarketViewTooLargeError
// below) the option chain for the universe and period is too large to load
// in one call. A degenerate MarketView the caller cannot distinguish from "a
// strategy that legitimately needs zero of some collection" is exactly the
// shape round-1 item 2 and round-2 item 10 both had to work around from the
// outside; every caller must now handle this explicitly instead.
export class MarketViewUnavailableError extends Error {
  constructor(reason: string) {
    super(`Market view unavailable: ${reason}`);
    this.name = "MarketViewUnavailableError";
  }
}

// A subclass, not a sibling: every caller that already catches
// `MarketViewUnavailableError` (run-chunk.ts) handles this the same way
// without change, while `instanceof MarketViewTooLargeError` stays
// available to a caller that wants to tell "no data" from "too much data"
// apart. Thrown instead of letting the chain query's own `inArray` bind
// list grow past what the driver accepts and throw a raw, uncaught error
// (round 3 item 2).
export class MarketViewTooLargeError extends MarketViewUnavailableError {
  constructor(reason: string) {
    super(reason);
    this.name = "MarketViewTooLargeError";
  }
}

export function emptyMarketView(): MarketView {
  return {
    calendar: [],
    candles: [],
    corporateActions: [],
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}

// The one place a `CandleRow` (repository shape) becomes the engine's own
// `Candle`: both the DataWindow-driven loader and the point-in-time
// operation builder share it so a candle's shape can never drift between
// them (round 1 item 12).
export function toEngineCandle(row: CandleRow): Candle {
  return {
    ticker: row.ticker,
    timeframe: "D1",
    session: row.session,
    asOf: instantSchema.parse(row.asOf.toISOString()),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    tradedQuantity: row.tradedQuantity,
  };
}

// `dataVersion` stamps the freshest row this view actually loaded, `max(asOf)`
// across every populated collection (candles, corporate actions, macro,
// option series and prices — never the calendar itself: `trading_sessions`
// carries no `asOf`, so a calendar revision between chunks contributes
// nothing to this stamp and is not caught by it, round 5 item 9): a
// backtest run compares this chunk to chunk so a revision to one of those
// stamped collections cannot silently mix two datasets into one immutable
// run.
function maxAsOf(instants: Iterable<Instant>): Instant | undefined {
  let max: Instant | undefined;
  for (const instant of instants) {
    if (max === undefined || instant > max) max = instant;
  }
  return max;
}

export interface LoadMarketViewCaps {
  // Overridable only for tests that need a tractable number of seeded rows
  // to cross it; every production caller gets DEFAULT_OPTION_CHAIN_TICKER_CAP.
  optionChainTickerCap?: number;
  // Same test-only shape, for DEFAULT_OPTION_PRICE_ROW_CAP (round 4 item 3).
  optionPriceRowCap?: number;
}

// The market-data module's "data view" for a batch of instruments
// (CONTEXT.md), driven entirely by the engine's own `DataWindow`
// (`engine.dataWindow`): the caller decides how far back to look and which
// collections a strategy actually needs, this only loads exactly that
// slice, so the window loaded and the window evaluated can never drift
// (#19; #18 round-2 correction, superseding round-2 item 7). Like
// `loadCandleSeries`, this stays nominal candles plus the corporate-action
// factors: adjustment happens only inside the engine's own
// `evaluateStrategy`, never here (CLAUDE.md's "no engine internals outside
// the package"). `buildOperationMarketView` below is a second entry over
// the same `emptyMarketView`/`toTradingSession`/`toEngineCandle` helpers,
// for the operation builder's different need (one underlying's chain as of
// `at`, not a strategy's indicator warm-up window).
export async function loadMarketView(
  db: Database,
  window: DataWindow,
  caps: LoadMarketViewCaps = {},
): Promise<MarketView> {
  const { instruments, from, to, collections } = window;
  const optionChainTickerCap = caps.optionChainTickerCap ?? DEFAULT_OPTION_CHAIN_TICKER_CAP;
  const optionPriceRowCap = caps.optionPriceRowCap ?? DEFAULT_OPTION_PRICE_ROW_CAP;

  const fromDate = new Date(from);
  const toDate = new Date(to);

  const sessions = await sessionsInRange(db, fromDate, toDate);
  const fromSession = sessions[0]?.date;
  const toSession = sessions.at(-1)?.date;

  // A period whose window overlaps no ingested session at all (round 2 item
  // 9): a candle-less-but-typed-as-valid MarketView here would let the
  // engine record `insufficient_data` for the whole run and still reach
  // `complete` with 0 operations. The caller must see this refusal
  // explicitly instead.
  if (!fromSession || !toSession) {
    throw new MarketViewUnavailableError("window has no trading session in the calendar");
  }

  const wantCandles = collections.includes("candles");
  const wantCorporateActions = collections.includes("corporateActions");
  const wantMacro = collections.includes("macro");
  const wantOptionSeries = collections.includes("optionSeries");
  const wantOptionPrices = collections.includes("optionPrices");

  const [candleRows, corporateActionRows, macroRows, seriesRows] = await Promise.all([
    wantCandles
      ? candlesInSessionRange(db, instruments, fromSession, toSession)
      : Promise.resolve([]),
    wantCorporateActions
      ? Promise.all(instruments.map((ticker) => corporateActionsForTicker(db, ticker))).then(
          (rows) => rows.flat(),
        )
      : Promise.resolve([]),
    wantMacro ? macroPointsInRange(db, fromSession, toSession) : Promise.resolve([]),
    // A strategy's chain window: every series listed on an underlying in
    // this universe that had not yet expired at the start of warmup, seen
    // on or before the window's own `to` (the engine, not this module,
    // decides per-step visibility off each row's own `asOf`). Bounded below
    // by `fromSession` (the same floor `buildOperationMarketView` applies
    // via its own `calendarFloor`, widened here to the whole
    // warmup-to-period span a range view needs) and above by
    // `optionChainTickerCap + 1`, so a chain this large is caught by row
    // count instead of by the driver rejecting the follow-on
    // `optionDailyPrices` query's `inArray` bind list (round 3 item 2).
    wantOptionSeries || wantOptionPrices
      ? db
          .select()
          .from(optionSeries)
          .where(
            and(
              inArray(optionSeries.underlying, instruments),
              lte(optionSeries.asOf, toDate),
              gte(optionSeries.expiry, fromSession),
            ),
          )
          .limit(optionChainTickerCap + 1)
      : Promise.resolve([]),
  ]);

  if ((wantOptionSeries || wantOptionPrices) && seriesRows.length > optionChainTickerCap) {
    throw new MarketViewTooLargeError(
      `option chain for this universe and period lists more than ${String(optionChainTickerCap)} series`,
    );
  }

  const candleView = candleRows.map(toEngineCandle);

  const corporateActions: CorporateActionFactor[] = corporateActionRows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    factor: toDecimal(row.factor),
  }));

  // The engine rejects an exact `(series, asOf)` collision outright
  // (`evaluateStrategy`'s own `sortUnique(view.macro, ...)`, run before
  // `resolveRiskFreeRate` ever sees the array) rather than tie-breaking it
  // — CDI at year end and IPCA within a publication month both produce
  // real collisions (macro-repository.ts's own comment on
  // `macroPointsInRange`). This loader is where that has to be resolved
  // before the view ever reaches the engine: `macroRows` arrives ordered
  // `date DESC`, so keeping only the first row seen per `(series, asOf)`
  // key keeps the fresher observation and drops the staler one silently
  // colliding with it (#18 round 7 item 1).
  const seenMacroKeys = new Set<string>();
  const dedupedMacroRows = macroRows.filter((row) => {
    const key = `${row.series}|${row.asOf.toISOString()}`;
    if (seenMacroKeys.has(key)) return false;
    seenMacroKeys.add(key);
    return true;
  });
  const macro: MacroPoint[] = dedupedMacroRows.map((row) => ({
    series: macroSeriesKindSchema.parse(row.series),
    date: sessionDateSchema.parse(row.date),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    annualRate: toDecimal(row.annualRate),
  }));

  const optionSeriesView: OptionSeries[] = wantOptionSeries
    ? seriesRows.map((row) => ({
        ticker: tickerSchema.parse(row.ticker),
        underlying: tickerSchema.parse(row.underlying),
        right: optionRightSchema.parse(row.right),
        strike: toDecimal(row.strike),
        expiry: sessionDateSchema.parse(row.expiry),
        style: exerciseStyleSchema.parse(row.style),
        asOf: instantSchema.parse(row.asOf.toISOString()),
      }))
    : [];

  const seriesTickers = [...new Set(seriesRows.map((row) => row.ticker))];
  const priceRows =
    wantOptionPrices && seriesTickers.length > 0
      ? await db
          .select()
          .from(optionDailyPrices)
          .where(
            and(
              inArray(optionDailyPrices.ticker, seriesTickers),
              gte(optionDailyPrices.session, fromSession),
              lte(optionDailyPrices.session, toSession),
            ),
          )
          .limit(optionPriceRowCap + 1)
      : [];

  if (wantOptionPrices && priceRows.length > optionPriceRowCap) {
    throw new MarketViewTooLargeError(
      `option day-price rows for this universe and period exceed ${String(optionPriceRowCap)}`,
    );
  }

  const optionPrices: OptionDayPrice[] = priceRows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    session: sessionDateSchema.parse(row.session),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    average: row.average ? toDecimal(row.average) : null,
    close: row.close ? toDecimal(row.close) : null,
    trades: row.trades,
    tradedQuantity: row.tradedQuantity,
  }));

  // A strategy's chain can carry an expiry beyond the window's own `to`
  // (a leg entered near the end of the window, still live when the run
  // stops): without extending the calendar to reach it, every such leg
  // would report `calendar_gap` on time-to-expiry instead of pricing
  // (mirrors `buildOperationMarketView`'s own forward extension below).
  const furthestOptionExpiry = furthestExpiry(seriesRows.map((row) => row.expiry));
  const extendedSessions =
    furthestOptionExpiry && furthestOptionExpiry > toSession
      ? await sessionsInRange(db, fromDate, new Date(`${furthestOptionExpiry}T23:59:59.999Z`))
      : sessions;
  const calendarView = extendedSessions.map(toTradingSession);

  // No implied-volatility-index ingestion pipeline exists yet (same gap
  // buildOperationMarketView already documents for dividendYields): the
  // window can ask for `impliedVolatilityIndex`, but there is nothing to
  // populate it with, so it stays empty regardless.
  const dataVersion = maxAsOf([
    ...candleView.map((row) => row.asOf),
    ...corporateActions.map((row) => row.asOf),
    ...macro.map((row) => row.asOf),
    ...optionSeriesView.map((row) => row.asOf),
    ...optionPrices.map((row) => row.asOf),
  ]);

  return {
    calendar: calendarView,
    candles: candleView,
    corporateActions,
    optionSeries: optionSeriesView,
    optionPrices,
    quotes: [],
    macro,
    dividendYields: [],
    impliedVolatilityIndex: [],
    ...(dataVersion ? { dataVersion } : {}),
  };
}

// The engine-shaped session for one calendar date, the only cross-module
// exposure of the trading calendar (CLAUDE.md "validation at the edges"):
// callers outside market-data get `TradingSession`, never the raw
// persistence row `sessionByDate` returns internally.
export async function tradingSessionForDate(
  db: Database,
  date: string,
): Promise<TradingSession | undefined> {
  const row = await sessionByDate(db, date);
  return row ? toTradingSession(row) : undefined;
}

// The engine-shaped trading session immediately before `date` (#19: the
// nightly evaluation's `since` anchor for a multi-session catch-up).
export async function previousTradingSession(
  db: Database,
  date: string,
): Promise<TradingSession | undefined> {
  const row = await sessionBefore(db, date);
  return row ? toTradingSession(row) : undefined;
}

// Every trading session up to `at`, oldest first, engine-shaped: the
// calendar `engine.dataWindow` needs to count a strategy's own indicator
// warm-up back from `since`/`at` (#19), and the same calendar a backtest
// chunk builds its own window from (run-chunk.ts), so a signal and a
// backtest of the same strategy version resolve warmup identically.
export async function calendarUpTo(db: Database, at: Date): Promise<TradingSession[]> {
  const rows = await sessionsUpTo(db, at);
  return rows.map(toTradingSession);
}

type SeriesRow = { strike: string; expiry: string; right: string; ticker: string };

// A true (ticker, asOf) duplicate must resolve to the same row regardless of query order.
// Mirrors the engine's own tie-break (packages/engine/src/internal/resolve-series.ts,
// `isEarlierOnExactTie`, ADR-0013's #21 addendum) so the collapsed chain the market view
// exposes and the series `priceOperation` actually prices agree (PR #76 round 2 item 2).
function isEarlierOnExactTie(a: SeriesRow, b: SeriesRow): boolean {
  const strikeCompare = new Decimal(a.strike).cmp(new Decimal(b.strike));
  if (strikeCompare !== 0) return strikeCompare < 0;
  if (a.expiry !== b.expiry) return a.expiry < b.expiry;
  if (a.right !== b.right) return a.right < b.right;
  return a.ticker < b.ticker;
}

function furthestExpiry(seriesExpiries: readonly string[]): string | null {
  return seriesExpiries.reduce<string | null>(
    (furthest, expiry) => (furthest === null || expiry > furthest ? expiry : furthest),
    null,
  );
}

// Assembles the slice of `MarketView` `priceOperation` needs to price one
// underlying and its option chain as of `at`: the underlying's own recent
// closes (a stock leg's price source), the chain's series and latest day
// prices, the calendar (time-to-expiry) and the CDI rate (the risk-free
// proxy `priceOperation` defaults to when none is given). The calendar
// covers both the trailing window (indicator-style lookback) and every
// session through the furthest expiry in the chain, or
// `resolveTimeToExpiryYears` reports `calendar_gap` for every option leg
// (round 1 item 1). Watchlists, quotes and dividend yields are the
// intraday tier, omitted here only costs the engine's own defaulting notes
// (`dividend_yield_defaulted`), never a wrong price. A second entry point
// over the same `emptyMarketView`/`toTradingSession`/`toEngineCandle`
// helpers `loadMarketView` (above) shares (round 1 item 12).
export async function buildOperationMarketView(
  db: Database,
  underlying: Ticker,
  at: Instant,
): Promise<MarketView> {
  const atDate = new Date(at);

  // The trailing edge of the calendar window, computed once up front so the
  // option series and price queries below can bound themselves by it: with
  // no floor, `optionSeries` accumulates every ticker this underlying has
  // ever listed and `optionDailyPrices` scans every session it was ever
  // priced on (PR #76 round 2 item 5). A structure's furthest expiry can
  // still extend the calendar forward past this floor (below); it can never
  // move the floor itself, which only depends on `at`.
  const pastCalendarRows = await calendarWindowThroughExpiry(
    db,
    atDate,
    CALENDAR_WINDOW_SESSIONS,
    null,
  );
  const calendarFloor = pastCalendarRows[0]?.date;

  const [seriesRows, candleRows, cdiRow, corporateActionRows] = await Promise.all([
    db
      .select()
      .from(optionSeries)
      .where(
        and(
          eq(optionSeries.underlying, underlying),
          lte(optionSeries.asOf, atDate),
          ...(calendarFloor ? [gte(optionSeries.expiry, calendarFloor)] : []),
        ),
      ),
    db
      .select()
      .from(candles)
      .where(
        and(
          eq(candles.ticker, underlying),
          eq(candles.timeframe, DAILY_TIMEFRAME),
          lte(candles.asOf, atDate),
        ),
      )
      .orderBy(desc(candles.session))
      .limit(CANDLE_WINDOW_SESSIONS),
    db
      .select()
      .from(macroPoints)
      .where(and(eq(macroPoints.series, "cdi"), lte(macroPoints.asOf, atDate)))
      .orderBy(desc(macroPoints.date))
      .limit(1),
    corporateActionsForTicker(db, underlying),
  ]);

  const calendarRows = await calendarWindowThroughExpiry(
    db,
    atDate,
    CALENDAR_WINDOW_SESSIONS,
    furthestExpiry(seriesRows.map((row) => row.expiry)),
  );

  const calendar: TradingSession[] = calendarRows.map(toTradingSession);

  const candleView: Candle[] = [...candleRows].reverse().map((row) =>
    toEngineCandle({
      ticker: tickerSchema.parse(row.ticker),
      session: sessionDateSchema.parse(row.session),
      asOf: row.asOf,
      open: toDecimal(row.open),
      high: toDecimal(row.high),
      low: toDecimal(row.low),
      close: toDecimal(row.close),
      tradedQuantity: row.tradedQuantity,
    }),
  );

  const optionSeriesView: OptionSeries[] = seriesRows.map((row) => ({
    ticker: row.ticker,
    underlying: row.underlying,
    right: optionRightSchema.parse(row.right),
    strike: toDecimal(row.strike),
    expiry: row.expiry,
    style: exerciseStyleSchema.parse(row.style),
    asOf: row.asOf.toISOString(),
  }));

  const latestSeriesByTicker = new Map<string, (typeof seriesRows)[number]>();
  for (const row of seriesRows) {
    const existing = latestSeriesByTicker.get(row.ticker);
    if (
      !existing ||
      row.asOf > existing.asOf ||
      (row.asOf.getTime() === existing.asOf.getTime() && isEarlierOnExactTie(row, existing))
    ) {
      latestSeriesByTicker.set(row.ticker, row);
    }
  }

  const optionTickers = [...latestSeriesByTicker.keys()];
  // Collapsed to one row per ticker in SQL (the latest session on or
  // before `at`) rather than fetched in full and reduced in JS, and bounded
  // by the same calendar floor as the series query above: an option's price
  // history since inception is not this view's concern (round 2 item 5).
  const priceRows =
    optionTickers.length === 0
      ? []
      : await db
          .selectDistinctOn([optionDailyPrices.ticker])
          .from(optionDailyPrices)
          .where(
            and(
              inArray(optionDailyPrices.ticker, optionTickers),
              lte(optionDailyPrices.asOf, atDate),
              ...(calendarFloor ? [gte(optionDailyPrices.session, calendarFloor)] : []),
            ),
          )
          .orderBy(asc(optionDailyPrices.ticker), desc(optionDailyPrices.session));

  // The latest visible price row per ticker, but only when its own
  // expiry/strike still match that ticker's latest visible series: B3
  // reuses option tickers across listing cycles (ADR-0017), so a price row
  // from a previous cycle can outlive the cycle it priced (round 1 item 2).
  const optionPricesByTicker = new Map<string, (typeof priceRows)[number]>();
  for (const row of priceRows) {
    const series = latestSeriesByTicker.get(row.ticker);
    if (!series || row.expiry !== series.expiry || row.strike !== series.strike) {
      continue;
    }
    optionPricesByTicker.set(row.ticker, row);
  }

  const optionPrices: OptionDayPrice[] = [...optionPricesByTicker.values()].map((row) => ({
    ticker: row.ticker,
    session: row.session,
    asOf: row.asOf.toISOString(),
    average: row.average ? toDecimal(row.average) : null,
    close: row.close ? toDecimal(row.close) : null,
    trades: row.trades,
    tradedQuantity: row.tradedQuantity,
  }));

  const latestCdi = cdiRow[0];
  const macro: MacroPoint[] = latestCdi
    ? [
        {
          series: "cdi",
          date: latestCdi.date,
          asOf: latestCdi.asOf.toISOString(),
          annualRate: toDecimal(latestCdi.annualRate),
        },
      ]
    : [];

  const corporateActions: CorporateActionFactor[] = corporateActionRows.map((row) => ({
    ticker: row.ticker,
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    factor: toDecimal(row.factor),
  }));

  const dataVersion = maxAsOf([
    ...candleView.map((row) => row.asOf),
    ...optionSeriesView.map((row) => row.asOf),
    ...optionPrices.map((row) => row.asOf),
    ...macro.map((row) => row.asOf),
    ...corporateActions.map((row) => row.asOf),
  ]);

  return {
    ...emptyMarketView(),
    calendar,
    candles: candleView,
    corporateActions,
    optionSeries: optionSeriesView,
    optionPrices,
    macro,
    ...(dataVersion ? { dataVersion } : {}),
  };
}
