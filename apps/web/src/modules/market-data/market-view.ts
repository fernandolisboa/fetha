import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type {
  Candle,
  MacroPoint,
  MarketView,
  OptionDayPrice,
  OptionSeries,
  TradingSession,
} from "@fetha/engine";
import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import { recentSessions } from "./repositories/calendar-repository";

const CANDLE_WINDOW_SESSIONS = 30;
const CALENDAR_WINDOW_SESSIONS = 30;

function toDecimal(value: string): DecimalString {
  return value as DecimalString;
}

// Assembles the slice of `MarketView` `priceOperation` needs to price one
// underlying and its option chain as of `at`: the underlying's own recent
// closes (a stock leg's price source), the chain's series and latest day
// prices, the calendar (time-to-expiry) and the CDI rate (the risk-free
// proxy `priceOperation` defaults to when none is given). Watchlists,
// quotes and dividend yields are the intraday tier and corporate actions'
// own ticket; omitting them here only costs the engine's own defaulting
// notes (`dividend_yield_defaulted`), never a wrong price.
export async function buildOperationMarketView(
  db: Database,
  underlying: Ticker,
  at: Instant,
): Promise<MarketView> {
  const atDate = new Date(at);

  const [calendarRows, candleRows, seriesRows, cdiRow] = await Promise.all([
    recentSessions(db, atDate, CALENDAR_WINDOW_SESSIONS),
    db
      .select()
      .from(candles)
      .where(
        and(eq(candles.ticker, underlying), eq(candles.timeframe, "D1"), lte(candles.asOf, atDate)),
      )
      .orderBy(desc(candles.session))
      .limit(CANDLE_WINDOW_SESSIONS),
    db.select().from(optionSeries).where(eq(optionSeries.underlying, underlying)),
    db
      .select()
      .from(macroPoints)
      .where(and(eq(macroPoints.series, "cdi"), lte(macroPoints.asOf, atDate)))
      .orderBy(desc(macroPoints.date))
      .limit(1),
  ]);

  const calendar: TradingSession[] = calendarRows.map((row) => ({
    date: row.date as SessionDate,
    open: row.open.toISOString() as Instant,
    close: row.close.toISOString() as Instant,
  }));

  const candleView: Candle[] = [...candleRows].reverse().map((row) => ({
    ticker: row.ticker as Ticker,
    timeframe: "D1",
    session: row.session as SessionDate,
    asOf: row.asOf.toISOString() as Instant,
    open: toDecimal(row.open),
    high: toDecimal(row.high),
    low: toDecimal(row.low),
    close: toDecimal(row.close),
    tradedQuantity: row.tradedQuantity,
  }));

  const optionSeriesView: OptionSeries[] = seriesRows.map((row) => ({
    ticker: row.ticker as Ticker,
    underlying: row.underlying as Ticker,
    right: row.right as OptionSeries["right"],
    strike: toDecimal(row.strike),
    expiry: row.expiry as SessionDate,
    style: row.style as OptionSeries["style"],
    asOf: row.asOf.toISOString() as Instant,
  }));

  const optionTickers = [...new Set(optionSeriesView.map((series) => series.ticker))];
  const priceRows =
    optionTickers.length === 0
      ? []
      : await db
          .select()
          .from(optionDailyPrices)
          .where(
            and(
              inArray(optionDailyPrices.ticker, optionTickers),
              lte(optionDailyPrices.asOf, atDate),
            ),
          );

  const optionPricesByTicker = new Map<string, (typeof priceRows)[number]>();
  for (const row of priceRows) {
    const existing = optionPricesByTicker.get(row.ticker);
    if (!existing || row.session > existing.session) {
      optionPricesByTicker.set(row.ticker, row);
    }
  }

  const optionPrices: OptionDayPrice[] = [...optionPricesByTicker.values()].map((row) => ({
    ticker: row.ticker as Ticker,
    session: row.session as SessionDate,
    asOf: row.asOf.toISOString() as Instant,
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
          date: latestCdi.date as SessionDate,
          asOf: latestCdi.asOf.toISOString() as Instant,
          annualRate: toDecimal(latestCdi.annualRate),
        },
      ]
    : [];

  return {
    calendar,
    candles: candleView,
    corporateActions: [],
    optionSeries: optionSeriesView,
    optionPrices,
    quotes: [],
    macro,
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}
