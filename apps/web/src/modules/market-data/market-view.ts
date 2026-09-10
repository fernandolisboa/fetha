import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  type DecimalString,
  type Instant,
  type Ticker,
} from "@fetha/contracts";
import type {
  Candle,
  CorporateActionFactor,
  MacroPoint,
  MarketView,
  OptionDayPrice,
  OptionSeries,
  TradingSession,
} from "@fetha/engine";

import type { Database } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import { calendarWindowThroughExpiry } from "./repositories/calendar-repository";
import { DAILY_TIMEFRAME } from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";

const CANDLE_WINDOW_SESSIONS = 30;
const CALENDAR_WINDOW_SESSIONS = 30;

function toDecimal(value: string): DecimalString {
  return decimalStringSchema.parse(value);
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

  const calendar: TradingSession[] = calendarRows.map((row) => ({
    date: sessionDateSchema.parse(row.date),
    open: instantSchema.parse(row.open.toISOString()),
    close: instantSchema.parse(row.close.toISOString()),
  }));

  const candleView: Candle[] = [...candleRows].reverse().map((row) => ({
    ticker: row.ticker,
    timeframe: "D1",
    session: row.session,
    asOf: row.asOf.toISOString(),
    open: toDecimal(row.open),
    high: toDecimal(row.high),
    low: toDecimal(row.low),
    close: toDecimal(row.close),
    tradedQuantity: row.tradedQuantity,
  }));

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
  };
}
