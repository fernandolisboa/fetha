import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  type Ticker,
} from "@fetha/contracts";
import { engine, type MarketView, type StrategyVersion, type TradingSession } from "@fetha/engine";

import type { Database } from "@/db/client";
import {
  candlesForPeriod,
  corporateActionsForTicker,
  macroPointsBetween,
  sessionsBetween,
} from "@/modules/market-data";

// The earliest session any ingestion source writes (ingest.ts,
// FIRST_INGESTED_CALENDAR_YEAR): a backtest's own warmup lookback can never
// reach further back than this, so it doubles as the calendar's lower bound
// for the engine's dataWindow() call below.
const EARLIEST_INGESTED_SESSION = "2024-01-01";

function toTradingSession(row: { date: string; open: Date; close: Date }): TradingSession {
  return {
    date: sessionDateSchema.parse(row.date),
    open: instantSchema.parse(row.open.toISOString()),
    close: instantSchema.parse(row.close.toISOString()),
  };
}

function emptyMarketView(): MarketView {
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

export interface BacktestMarketViewInput {
  strategy: StrategyVersion;
  universe: Ticker[];
  period: { from: string; to: string };
}

// Builds a backtest's whole-period MarketView from the database, the same
// division of labor as market-data/candle-series.ts for a single-instrument
// chart: this module resolves rows, the engine's public dataWindow() alone
// decides how far back a strategy's own warmup needs to reach (CLAUDE.md:
// "no engine internals" outside packages/engine).
export async function loadBacktestMarketView(
  db: Database,
  input: BacktestMarketViewInput,
): Promise<MarketView> {
  const { strategy, universe, period } = input;

  const calendarRows = await sessionsBetween(db, EARLIEST_INGESTED_SESSION, period.to);
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

  const [candlesByTicker, corporateActionsByTicker] = await Promise.all([
    Promise.all(
      universe.map((ticker) => candlesForPeriod(db, ticker, warmupSession.date, period.to)),
    ),
    Promise.all(universe.map((ticker) => corporateActionsForTicker(db, ticker))),
  ]);

  const macroRows = await macroPointsBetween(db, warmupSession.date, period.to);

  return {
    calendar,
    candles: candlesByTicker.flat().map((row) => ({
      ticker: row.ticker,
      timeframe: "D1",
      session: row.session,
      asOf: instantSchema.parse(row.asOf.toISOString()),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      tradedQuantity: row.tradedQuantity,
    })),
    corporateActions: corporateActionsByTicker.flat().map((row) => ({
      ticker: row.ticker,
      exDate: sessionDateSchema.parse(row.exDate),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      factor: decimalStringSchema.parse(row.factor),
    })),
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro: macroRows.map((row) => ({
      series: row.series as MarketView["macro"][number]["series"],
      date: sessionDateSchema.parse(row.date),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      annualRate: decimalStringSchema.parse(row.annualRate),
    })),
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}
