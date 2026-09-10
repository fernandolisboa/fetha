import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type Ticker,
} from "@fetha/contracts";
import type {
  DataWindow,
  ExerciseStyle,
  MacroSeriesKind,
  MarketView,
  OptionRight,
  TradingSession,
} from "@fetha/engine";

import type { Database } from "@/db/client";

import {
  sessionBefore,
  sessionByDate,
  sessionsInRange,
  sessionsUpTo,
} from "./repositories/calendar-repository";
import { candlesInSessionRange, type CandleRow } from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";
import { macroPointsInRange } from "./repositories/macro-repository";
import {
  optionPricesInSessionRange,
  optionSeriesForUnderlyings,
} from "./repositories/option-repository";

const ENGINE_TIMEFRAME = "D1";

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
// the package").
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
      series: row.series as MacroSeriesKind,
      date: sessionDateSchema.parse(row.date),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      annualRate: decimalStringSchema.parse(row.annualRate),
    })),
    optionSeries: optionSeriesRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      underlying: tickerSchema.parse(row.underlying),
      right: row.right as OptionRight,
      strike: decimalStringSchema.parse(row.strike),
      expiry: sessionDateSchema.parse(row.expiry),
      style: row.style as ExerciseStyle,
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
