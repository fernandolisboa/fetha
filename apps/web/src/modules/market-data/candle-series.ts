import { decimalStringSchema, instantSchema, type Ticker } from "@fetha/contracts";
import {
  engine,
  type CandleForm,
  type IndicatorSeries,
  type MarketView,
  type Result,
} from "@fetha/engine";

import type { Database } from "@/db/client";

import { corporateActionsForTicker } from "./repositories/corporate-action-repository";
import { recentDailyCandles } from "./repositories/candle-repository";
import { emptyMarketView, toEngineCandle } from "./market-view";

const CANDLE_LOOKBACK_SESSIONS = 260;
const ENGINE_TIMEFRAME = "D1";

// The market-data module's "data view" exposure for a chart (CONTEXT.md):
// nominal candles plus the corporate-action factors visible for `ticker`,
// packaged as the engine's `MarketView`. Adjustment itself happens only
// inside the engine's public `indicators()` call below, never here (the
// ticket's "no engine internals" constraint).
export async function loadCandleSeries(
  db: Database,
  ticker: Ticker,
  form: CandleForm,
  now: Date = new Date(),
): Promise<Result<IndicatorSeries>> {
  const [candleRows, corporateActionRows] = await Promise.all([
    recentDailyCandles(db, ticker, CANDLE_LOOKBACK_SESSIONS),
    corporateActionsForTicker(db, ticker),
  ]);

  const view: MarketView = {
    ...emptyMarketView(),
    candles: candleRows.map((row) => toEngineCandle(row)),
    corporateActions: corporateActionRows.map((row) => ({
      ticker,
      exDate: row.exDate,
      asOf: instantSchema.parse(row.asOf.toISOString()),
      factor: decimalStringSchema.parse(row.factor),
    })),
  };

  return engine.indicators({
    view,
    ticker,
    timeframe: ENGINE_TIMEFRAME,
    indicators: [],
    at: instantSchema.parse(now.toISOString()),
    form,
  });
}
