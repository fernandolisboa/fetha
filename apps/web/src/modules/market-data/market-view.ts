import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type Instant,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import {
  engine,
  type Candle,
  type CorporateActionFactor,
  type MacroPoint,
  type MarketView,
  type OptionDayPrice,
  type OptionSeries,
  type StrategyVersion,
  type TradingSession,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import {
  calendarWindowThroughExpiry,
  earliestSession,
  sessionsBetween,
} from "./repositories/calendar-repository";
import {
  candlesForPeriod,
  DAILY_TIMEFRAME,
  type CandleRow,
} from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";
import { macroPointsBetween } from "./repositories/macro-repository";

const CANDLE_WINDOW_SESSIONS = 30;
const CALENDAR_WINDOW_SESSIONS = 30;

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
// `Candle`: both range and point MarketView builders share it so a
// candle's shape can never drift between them (round 1 item 12).
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
// across every populated collection: a backtest run compares it chunk to
// chunk so a candle or calendar revision between chunks cannot silently mix
// datasets in one immutable run (round 1 item 21).
function maxAsOf(instants: Iterable<Instant>): Instant | undefined {
  let max: Instant | undefined;
  for (const instant of instants) {
    if (max === undefined || instant > max) max = instant;
  }
  return max;
}

export function resolveWarmupSession(
  calendar: TradingSession[],
  from: string,
): TradingSession | undefined {
  const firstSession = calendar[0];
  if (firstSession && firstSession.open === from) {
    return firstSession;
  }
  const precedingIndex = calendar.findIndex((session) => session.close === from);
  return precedingIndex >= 0 ? calendar[precedingIndex + 1] : undefined;
}

export interface MarketViewRangeInput {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: SessionDate; to: SessionDate };
}

// Builds a whole-period MarketView from the database, driven by the
// engine's own `dataWindow()`: this module resolves rows, the engine alone
// decides how far back a strategy's warmup needs to reach (CLAUDE.md: "no
// engine internals" outside packages/engine) and which collections the
// strategy actually needs (`window.collections`), so a stock-only strategy
// never pays for an option-chain query it will never read. Shared by
// backtests (loadMarketView) and, at rebase, the signals inbox (#77).
export async function loadMarketView(
  db: Database,
  input: MarketViewRangeInput,
): Promise<MarketView> {
  const { strategy, universe, period } = input;

  const calendarFloor = await earliestSession(db);
  if (!calendarFloor) {
    return emptyMarketView();
  }

  const calendarRows = await sessionsBetween(db, calendarFloor, period.to);
  const calendar = calendarRows.map(toTradingSession);

  const fromSession = calendar.find((session) => session.date === period.from);
  const toSession = calendar.find((session) => session.date === period.to) ?? calendar.at(-1);

  if (!fromSession || !toSession) {
    return { ...emptyMarketView(), calendar };
  }

  const window = engine.dataWindow({
    strategy,
    instruments: universe,
    calendar,
    at: toSession.close,
    since: fromSession.open,
  });

  // engine.dataWindow() returns `from` as an *Instant*, not a session date,
  // and it is either the very first calendar session's own open (when no
  // earlier warmup is needed) or the *close* of the session immediately
  // preceding the earliest one actually needed
  // (packages/engine/src/internal/data-window.ts computeFrom): matching it
  // against `session.open` alone, with a same-session fallback, silently
  // resolved to `fromSession` on every run whose warmup reaches back
  // further than the requested period, loading zero warm-up history.
  const warmupSession = resolveWarmupSession(calendar, window.from);
  if (!warmupSession) {
    return { ...emptyMarketView(), calendar };
  }

  const collections = new Set(window.collections);

  const [candlesByTicker, corporateActionsByTicker, macroRows] = await Promise.all([
    collections.has("candles")
      ? Promise.all(
          universe.map((ticker) => candlesForPeriod(db, ticker, warmupSession.date, period.to)),
        )
      : Promise.resolve([]),
    collections.has("corporateActions")
      ? Promise.all(universe.map((ticker) => corporateActionsForTicker(db, ticker)))
      : Promise.resolve([]),
    collections.has("macro")
      ? macroPointsBetween(db, warmupSession.date, period.to)
      : Promise.resolve([]),
  ]);

  const candleRows = candlesByTicker.flat();
  const candleView = candleRows.map(toEngineCandle);

  const corporateActionRows = corporateActionsByTicker.flat();
  const corporateActions: CorporateActionFactor[] = corporateActionRows.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    factor: toDecimal(row.factor),
  }));

  const macro: MacroPoint[] = macroRows.map((row) => ({
    series: row.series as MacroPoint["series"],
    date: sessionDateSchema.parse(row.date),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    annualRate: toDecimal(row.annualRate),
  }));

  // No implied-volatility-index ingestion pipeline exists yet (same gap
  // buildOperationMarketView already documents for dividendYields): the
  // window can ask for `impliedVolatilityIndex`, but there is nothing to
  // populate it with, so it stays empty regardless.
  const dataVersion = maxAsOf([
    ...candleView.map((row) => row.asOf),
    ...corporateActions.map((row) => row.asOf),
    ...macro.map((row) => row.asOf),
  ]);

  return {
    calendar,
    candles: candleView,
    corporateActions,
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro,
    dividendYields: [],
    impliedVolatilityIndex: [],
    ...(dataVersion ? { dataVersion } : {}),
  };
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
    right: row.right as OptionSeries["right"],
    strike: toDecimal(row.strike),
    expiry: row.expiry,
    style: row.style as OptionSeries["style"],
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
    calendar,
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
