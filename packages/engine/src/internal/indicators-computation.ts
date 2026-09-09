import Decimal from "decimal.js";
import { ENGINE_VERSION } from "../api";
import type {
  EngineError,
  IndicatorSeries,
  IndicatorsInput,
  Result,
  TruncationReport,
} from "../api";
import { alignToSessions } from "./align-to-sessions";
import { buildCandleSeries } from "./candle-series";
import { PRICE_SCALE, RATIO_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { atr } from "./indicators/atr";
import { ema } from "./indicators/ema";
import { ivRank } from "./indicators/iv-rank";
import { rsi } from "./indicators/rsi";
import { sma } from "./indicators/sma";
import { buildIvIndexSeries } from "./iv-index-series";

export function computeIndicators(input: IndicatorsInput): Result<IndicatorSeries> {
  const form = input.form ?? "adjusted";

  const candleSeries = buildCandleSeries({
    candles: input.view.candles,
    corporateActions: input.view.corporateActions,
    ticker: input.ticker,
    timeframe: input.timeframe,
    at: input.at,
  });
  if (!candleSeries.ok) {
    return invalidInput(candleSeries.error.path, candleSeries.error.message);
  }

  const closes = candleSeries.value.adjusted.map((c) => parseDecimal(c.close));
  const sessions = candleSeries.value.adjusted.map((c) => c.session);
  const bars = candleSeries.value.adjusted.map((c) => ({
    high: parseDecimal(c.high),
    low: parseDecimal(c.low),
    close: parseDecimal(c.close),
  }));

  const truncated: TruncationReport[] = [...candleSeries.value.truncated];
  let ivPointSessions: string[] = [];
  let ivPointValues: Decimal[] = [];

  if (input.indicators.some((spec) => spec.kind === "iv_rank")) {
    const ivSeries = buildIvIndexSeries({
      points: input.view.impliedVolatilityIndex,
      underlying: input.ticker,
      at: input.at,
    });
    if (!ivSeries.ok) {
      return invalidInput(ivSeries.error.path, ivSeries.error.message);
    }
    truncated.push(...ivSeries.value.truncated);
    ivPointSessions = ivSeries.value.points.map((p) => p.session);
    ivPointValues = ivSeries.value.points.map((p) => parseDecimal(p.impliedVolatility));
  }

  const series = input.indicators.map((indicator) => {
    switch (indicator.kind) {
      case "sma":
        return { indicator, values: toDecimalStrings(sma(closes, indicator.length), PRICE_SCALE) };
      case "ema":
        return { indicator, values: toDecimalStrings(ema(closes, indicator.length), PRICE_SCALE) };
      case "rsi":
        return { indicator, values: toDecimalStrings(rsi(closes, indicator.length), RATIO_SCALE) };
      case "atr":
        return { indicator, values: toDecimalStrings(atr(bars, indicator.length), PRICE_SCALE) };
      case "iv_rank": {
        const rankSeries = ivRank(ivPointValues, indicator.lookbackSessions);
        const aligned = alignToSessions(sessions, ivPointSessions, rankSeries);
        return {
          indicator,
          values: aligned.map((v) => (v ? toDecimalString(v, RATIO_SCALE) : null)),
        };
      }
    }
  });

  return {
    ok: true,
    value: {
      ticker: input.ticker,
      timeframe: input.timeframe,
      form,
      candles: form === "adjusted" ? candleSeries.value.adjusted : candleSeries.value.nominal,
      series,
      notes: [],
      provenance: {
        engineVersion: ENGINE_VERSION,
        pricingModel: "bsm_continuous_yield",
        truncated,
        dataVersion: input.view.dataVersion ?? null,
        datasetNotes: input.view.datasetNotes ?? [],
      },
    },
  };
}

function toDecimalStrings(values: (Decimal | null)[], scale: number) {
  return values.map((v) => (v ? toDecimalString(v, scale) : null));
}

function invalidInput(path: string, message: string): { ok: false; error: EngineError } {
  return { ok: false, error: { code: "invalid_input", path, message } };
}
