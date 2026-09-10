import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import { z } from "zod";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type Instant,
  type Ticker,
} from "@fetha/contracts";
import {
  exerciseStyles,
  macroSeriesKinds,
  optionRights,
  type Candle,
  type CorporateActionFactor,
  type DataWindow,
  type MacroPoint,
  type MarketView,
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
import {
  optionPricesInSessionRange,
  optionSeriesForUnderlyings,
} from "./repositories/option-repository";

const ENGINE_TIMEFRAME = "D1";
const CANDLE_WINDOW_SESSIONS = 30;
const CALENDAR_WINDOW_SESSIONS = 30;

function toDecimal(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

const macroSeriesKindSchema = z.enum(macroSeriesKinds);
const optionRightSchema = z.enum(optionRights);
const exerciseStyleSchema = z.enum(exerciseStyles);

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

export function toTradingSession(row: { date: string; open: Date; close: Date }): TradingSession {
  return {
    date: sessionDateSchema.parse(row.date),
    open: instantSchema.parse(row.open.toISOString()),
    close: instantSchema.parse(row.close.toISOString()),
  };
}

export function toEngineCandle(ticker: Ticker, row: CandleRow): MarketView["candles"][number] {
  return {
    ticker,
    timeframe: ENGINE_TIMEFRAME,
    session: row.session,
    asOf: instantSchema.parse(row.asOf.toISOString()),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    tradedQuantity: row.tradedQuantity,
  };
}

// The market-data module's "data view" for a batch of instruments
// (CONTEXT.md), driven entirely by the engine's own `DataWindow`
// (`engine.dataWindow`): the caller decides how far back to look and which
// collections a strategy actually needs, this only loads exactly that slice.
// Like `loadCandleSeries`, this stays nominal candles plus the
// corporate-action factors: adjustment happens only inside the engine's own
// `evaluateStrategy`, never here (CLAUDE.md's "no engine internals outside
// the package"). `buildOperationMarketView` below is a second entry over the
// same `emptyMarketView`/`toTradingSession`/`toEngineCandle` helpers, for the
// operation builder's different need (one underlying's chain as of `at`,
// not a strategy's indicator warm-up window).
export async function loadMarketView(db: Database, window: DataWindow): Promise<MarketView> {
  const { instruments, from, to, collections } = window;
  const fromDate = new Date(from);
  const toDate = new Date(to);

  const sessions = await sessionsInRange(db, fromDate, toDate);
  const fromSession = sessions[0]?.date;
  const toSession = sessions.at(-1)?.date;

  const wantCandles = collections.includes("candles") && fromSession && toSession;
  const wantCorporateActions = collections.includes("corporateActions");
  const wantMacro = collections.includes("macro") && fromSession && toSession;
  const wantOptionSeries = collections.includes("optionSeries");
  const wantOptionPrices = collections.includes("optionPrices") && fromSession && toSession;

  const [candleRows, corporateActionRows, macroRows, optionSeriesRows] = await Promise.all([
    wantCandles
      ? candlesInSessionRange(db, instruments, fromSession, toSession)
      : Promise.resolve([]),
    wantCorporateActions
      ? Promise.all(instruments.map((ticker) => corporateActionsForTicker(db, ticker))).then(
          (rows) => rows.flat(),
        )
      : Promise.resolve([]),
    wantMacro ? macroPointsInRange(db, fromSession, toSession) : Promise.resolve([]),
    wantOptionSeries ? optionSeriesForUnderlyings(db, instruments) : Promise.resolve([]),
  ]);

  const optionTickers = optionSeriesRows.map((row) => row.ticker);
  const optionPriceRows =
    wantOptionPrices && optionTickers.length > 0
      ? await optionPricesInSessionRange(db, optionTickers, fromSession, toSession)
      : [];

  return {
    ...emptyMarketView(),
    calendar: sessions.map(toTradingSession),
    candles: candleRows.map((row) => toEngineCandle(row.ticker, row)),
    corporateActions: corporateActionRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      exDate: sessionDateSchema.parse(row.exDate),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      factor: decimalStringSchema.parse(row.factor),
    })),
    macro: macroRows.map((row) => ({
      series: macroSeriesKindSchema.parse(row.series),
      date: sessionDateSchema.parse(row.date),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      annualRate: decimalStringSchema.parse(row.annualRate),
    })),
    optionSeries: optionSeriesRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      underlying: tickerSchema.parse(row.underlying),
      right: optionRightSchema.parse(row.right),
      strike: decimalStringSchema.parse(row.strike),
      expiry: sessionDateSchema.parse(row.expiry),
      style: exerciseStyleSchema.parse(row.style),
      asOf: instantSchema.parse(row.asOf.toISOString()),
    })),
    optionPrices: optionPriceRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      session: sessionDateSchema.parse(row.session),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      average: row.average === null ? null : decimalStringSchema.parse(row.average),
      close: row.close === null ? null : decimalStringSchema.parse(row.close),
      trades: row.trades,
      tradedQuantity: row.tradedQuantity,
    })),
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
// warm-up back from `since`/`at` (#19).
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
// (`dividend_yield_defaulted`), never a wrong price.
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
    toEngineCandle(underlying, {
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

  return {
    ...emptyMarketView(),
    calendar,
    candles: candleView,
    corporateActions,
    optionSeries: optionSeriesView,
    optionPrices,
    macro,
  };
}
