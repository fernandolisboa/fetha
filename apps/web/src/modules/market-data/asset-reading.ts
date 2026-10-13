import {
  decimalStringSchema,
  exerciseStyleSchema,
  instantSchema,
  optionRightSchema,
  sessionDateSchema,
  tickerSchema,
  type Ticker,
} from "@fetha/contracts";
import { assetReadingThresholds, engine, type AssetReading, type MarketView } from "@fetha/engine";

import type { Database } from "@/db/client";

import { toEngineCandle, toEngineCorporateActions, toTradingSession } from "./market-view";
import { recentSessions } from "./repositories/calendar-repository";
import { candlesInSessionRange, latestCandle } from "./repositories/candle-repository";
import { corporateActionsForTicker } from "./repositories/corporate-action-repository";
import { ivIndexPointsInRange } from "./repositories/iv-index-repository";
import {
  DEFAULT_OPTION_PRICE_ROW_CAP,
  optionPricesInSessionRange,
  optionSeriesForUnderlyingAt,
} from "./repositories/option-repository";

// Sessions the newest candle or IV point may trail the calendar by (the nightly ingestion runs
// hours after the B3 close, and a failed run adds a day): the engine anchors each window at the
// session it reads, so the view must still reach that many sessions further back.
const INGESTION_LAG_SESSIONS = 5;

// The longest window any reading needs (ADR-0059): SMA 200 over candles, IV rank over 252
// sessions of IV points, Wilder RSI and ATR over 6 x 14 candles (ADR-0048), plus the lag above.
export const ASSET_READING_SESSIONS =
  Math.max(
    assetReadingThresholds.smaLongLength,
    assetReadingThresholds.ivRankLookbackSessions,
    assetReadingThresholds.rsiLength * 6,
    assetReadingThresholds.atrLength * 6,
  ) + INGESTION_LAG_SESSIONS;

// One ticker's view for `engine.assetReading`: the calendar and candles of the last
// ASSET_READING_SESSIONS sessions, the IV index points over the same sessions, and the option
// chain still listed at the reading session with that session's day prices only. Nothing here
// computes a reading; the engine does.
export async function buildAssetReadingView(
  db: Database,
  ticker: Ticker,
  at: Date,
): Promise<MarketView> {
  const [sessionRows, lastCandle, corporateActionRows] = await Promise.all([
    recentSessions(db, at, ASSET_READING_SESSIONS),
    latestCandle(db, ticker),
    corporateActionsForTicker(db, ticker),
  ]);
  const fromSession = sessionRows[0]?.date;
  const toSession = sessionRows.at(-1)?.date;
  if (!fromSession || !toSession) {
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
  const readingSession =
    lastCandle && lastCandle.session <= toSession ? lastCandle.session : toSession;

  const [candleRows, ivRows, seriesRows] = await Promise.all([
    candlesInSessionRange(db, [ticker], fromSession, toSession),
    ivIndexPointsInRange(db, [ticker], fromSession, toSession),
    optionSeriesForUnderlyingAt(db, ticker, at, readingSession),
  ]);

  const seriesTickers = [...new Set(seriesRows.map((row) => row.ticker))];
  const prices =
    seriesTickers.length === 0
      ? { ok: true as const, rows: [] }
      : await optionPricesInSessionRange(
          db,
          seriesTickers,
          { fromSession: readingSession, toSession: readingSession },
          DEFAULT_OPTION_PRICE_ROW_CAP,
        );
  const priceRows = prices.ok ? prices.rows : [];

  return {
    calendar: sessionRows.map(toTradingSession),
    candles: candleRows.map(toEngineCandle),
    corporateActions: toEngineCorporateActions(corporateActionRows),
    optionSeries: seriesRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      underlying: tickerSchema.parse(row.underlying),
      right: optionRightSchema.parse(row.right),
      strike: decimalStringSchema.parse(row.strike),
      expiry: sessionDateSchema.parse(row.expiry),
      style: exerciseStyleSchema.parse(row.style),
      asOf: instantSchema.parse(row.asOf.toISOString()),
    })),
    optionPrices: priceRows.map((row) => ({
      ticker: tickerSchema.parse(row.ticker),
      session: sessionDateSchema.parse(row.session),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      average: row.average === null ? null : decimalStringSchema.parse(row.average),
      close: row.close === null ? null : decimalStringSchema.parse(row.close),
      trades: row.trades,
      tradedQuantity: row.tradedQuantity,
    })),
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: ivRows.map((row) => ({
      underlying: tickerSchema.parse(row.underlying),
      session: sessionDateSchema.parse(row.session),
      asOf: instantSchema.parse(row.asOf.toISOString()),
      impliedVolatility: decimalStringSchema.parse(row.impliedVolatility),
    })),
  };
}

// The engine's reading of `ticker` with everything ingested so far, or null when a stored row
// fails its schema or the engine refuses the view; a page renders the asset without its reading
// rather than failing.
export async function loadAssetReading(
  db: Database,
  ticker: Ticker,
  at: Date = new Date(),
): Promise<AssetReading | null> {
  let view: MarketView;
  try {
    view = await buildAssetReadingView(db, ticker, at);
  } catch (error) {
    console.error("assetReading view failed", { ticker, error });
    return null;
  }
  const result = await engine.assetReading({
    view,
    ticker,
    at: instantSchema.parse(at.toISOString()),
  });
  if (!result.ok) {
    console.error("assetReading failed", { ticker, code: result.error.code });
    return null;
  }
  return result.value;
}
