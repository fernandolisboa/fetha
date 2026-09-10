import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  type Ticker,
} from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

import type { Database } from "@/db/client";

import { toEngineCandle } from "./candle-series";
import { recentSessions } from "./repositories/calendar-repository";
import { recentDailyCandles } from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";

const CANDLE_LOOKBACK_SESSIONS = 260;

// The market-data module's "data view" for a batch of instruments
// (CONTEXT.md), used by the strategies module's nightly evaluation (#19) to
// assemble one MarketView per user's watchlist. Like `loadCandleSeries`,
// this stays nominal candles plus the corporate-action factors: adjustment
// happens only inside the engine's own `evaluateStrategy`.
export async function loadMarketView(
  db: Database,
  tickers: Ticker[],
  now: Date = new Date(),
): Promise<MarketView> {
  const [sessions, perTicker] = await Promise.all([
    recentSessions(db, now, CANDLE_LOOKBACK_SESSIONS),
    Promise.all(
      tickers.map(async (ticker) => ({
        ticker,
        candles: await recentDailyCandles(db, ticker, CANDLE_LOOKBACK_SESSIONS),
        corporateActions: await corporateActionsForTicker(db, ticker),
      })),
    ),
  ]);

  return {
    calendar: sessions.map((session) => ({
      date: sessionDateSchema.parse(session.date),
      open: instantSchema.parse(session.open.toISOString()),
      close: instantSchema.parse(session.close.toISOString()),
    })),
    candles: perTicker.flatMap(({ ticker, candles }) =>
      candles.map((row) => toEngineCandle(ticker, row)),
    ),
    corporateActions: perTicker.flatMap(({ ticker, corporateActions }) =>
      corporateActions.map((row) => ({
        ticker,
        exDate: sessionDateSchema.parse(row.exDate),
        asOf: instantSchema.parse(row.asOf.toISOString()),
        factor: decimalStringSchema.parse(row.factor),
      })),
    ),
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}
