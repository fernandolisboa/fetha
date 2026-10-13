import Decimal from "decimal.js";
import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import {
  assetReadingThresholds,
  type AssetReading,
  type ImpliedVolatilityLabel,
  type MarketView,
  type MomentumLabel,
  type OptionDayPrice,
  type OptionLiquidityLabel,
  type RangeLabel,
  type Result,
  type TruncationReport,
  type TrendLabel,
} from "../api";
import { sessionAtOrBefore, sessionByDate, sortedCalendar } from "./calendar";
import { buildCandleSeries } from "./candle-series";
import { tradingCalendar } from "./data-window";
import { PRICE_SCALE, RATIO_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { invalidInput, err } from "./errors";
import { ivRank } from "./indicators/iv-rank";
import { sma } from "./indicators/sma";
import { isAfter, isAtOrBefore } from "./instant";
import { buildIvIndexSeries } from "./iv-index-series";
import { codeUnitCompare } from "./order";
import type { ProvenanceBase } from "./provenance";
import { readingAt } from "./reading-at";
import { collapseSeriesByTicker } from "./resolve-series";
import { validateViewIntegrity } from "./validate-view-integrity";
import { rowsWithKey } from "./view-index";

// `readingAt`'s `rankedIvSessions` callback is only ever invoked for an `iv_rank` indicator
// (ADR-0059's own iv_rank handling never goes through `readingAt`, see
// `computeImpliedVolatilityReading`): every call below reads an `sma`, `rsi` or `atr`, so this is
// never actually called, only ever passed.
const neverRankedIvSessions = (): readonly SessionDate[] => [];

// ADR-0059's project-default label boundaries: every boundary is inclusive on the side of the
// extreme label.
export function classifyTrend(
  close: DecimalString,
  smaShort: DecimalString | null,
  smaLong: DecimalString | null,
): TrendLabel | null {
  if (smaShort === null || smaLong === null) return null;
  const closeValue = parseDecimal(close);
  const shortValue = parseDecimal(smaShort);
  const longValue = parseDecimal(smaLong);
  if (closeValue.gt(shortValue) && shortValue.gt(longValue)) return "up";
  if (closeValue.lt(shortValue) && shortValue.lt(longValue)) return "down";
  return "sideways";
}

export function classifyMomentum(rsiValue: DecimalString | null): MomentumLabel | null {
  if (rsiValue === null) return null;
  const value = parseDecimal(rsiValue);
  if (value.lte(new Decimal(assetReadingThresholds.rsiOversold))) return "oversold";
  if (value.gte(new Decimal(assetReadingThresholds.rsiOverbought))) return "overbought";
  return "neutral";
}

export function classifyRange(atrShare: DecimalString | null): RangeLabel | null {
  if (atrShare === null) return null;
  const value = parseDecimal(atrShare);
  if (value.lte(new Decimal(assetReadingThresholds.atrShareCalm))) return "calm";
  if (value.gte(new Decimal(assetReadingThresholds.atrShareWide))) return "wide";
  return "normal";
}

export function classifyImpliedVolatility(
  ivRankValue: DecimalString | null,
): ImpliedVolatilityLabel | null {
  if (ivRankValue === null) return null;
  const value = parseDecimal(ivRankValue);
  if (value.lte(new Decimal(assetReadingThresholds.ivRankLow))) return "low";
  if (value.gte(new Decimal(assetReadingThresholds.ivRankHigh))) return "high";
  return "normal";
}

export function classifyOptionLiquidity(tradedSeries: number): OptionLiquidityLabel {
  if (tradedSeries >= assetReadingThresholds.liquidTradedSeries) return "liquid";
  if (tradedSeries >= 1) return "thin";
  return "none";
}

const optionPriceTickerOf = (p: OptionDayPrice): string => p.ticker;

function hasTrade(
  prices: readonly OptionDayPrice[],
  ticker: Ticker,
  session: SessionDate,
  at: Instant,
): boolean {
  let latest: OptionDayPrice | null = null;
  for (const p of rowsWithKey(prices, optionPriceTickerOf, ticker)) {
    if (p.session !== session || !isAtOrBefore(p.asOf, at)) continue;
    if (latest === null || isAfter(p.asOf, latest.asOf)) latest = p;
  }
  return latest !== null && latest.trades > 0;
}

// The strict session-gap checks `readingAt` applies (ADR-0050 for `sma`, ADR-0051 for `iv_rank`,
// both reused here for every candle- and IV-based reading) are anchored at the instant the window
// ends: reading them off `at` directly (now, in
// production) rather than off the session actually being read lets the gap between that
// session's own close and the nightly ingestion that publishes its candle/IV point look like a
// missing session every single day, nulling SMA 50/200, trend and IV rank for a ticker with years
// of uninterrupted history. Anchored instead at that session's own close - the instant it was
// itself read at - when the calendar carries it and that close is not itself after `at` (a
// session the calendar has not closed yet cannot anchor anything); `at` otherwise, unchanged.
function windowEndFor(view: MarketView, session: SessionDate, at: Instant): Instant {
  const calendarSession = sessionByDate(view.calendar, session);
  return calendarSession && isAtOrBefore(calendarSession.close, at) ? calendarSession.close : at;
}

function readingSessionFor(
  view: MarketView,
  candleSession: SessionDate | null,
  at: Instant,
): SessionDate | null {
  if (candleSession !== null) return candleSession;
  return sessionAtOrBefore(sortedCalendar(view.calendar), at)?.date ?? null;
}

function computeOptionsReading(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  candleSession: SessionDate | null,
): AssetReading["options"] {
  const session = readingSessionFor(view, candleSession, at);
  if (session === null) {
    return { label: "none", session: null, tradedSeries: 0, nextExpiries: [] };
  }

  const listed = collapseSeriesByTicker(view.optionSeries, at).filter(
    (series) => series.underlying === ticker && series.expiry >= session,
  );
  const tradedTickers = new Set<Ticker>();
  for (const series of listed) {
    if (hasTrade(view.optionPrices, series.ticker, session, at)) tradedTickers.add(series.ticker);
  }

  const expiries = [...new Set(listed.map((series) => series.expiry))]
    .sort(codeUnitCompare)
    .slice(0, assetReadingThresholds.nextExpiries);
  const nextExpiries = expiries.map((expiry) => {
    const atExpiry = listed.filter((series) => series.expiry === expiry);
    const tradedAtExpiry = atExpiry.filter((series) => tradedTickers.has(series.ticker)).length;
    return { expiry, series: atExpiry.length, tradedSeries: tradedAtExpiry };
  });

  const tradedSeries = tradedTickers.size;
  return {
    label: classifyOptionLiquidity(tradedSeries),
    session,
    tradedSeries,
    nextExpiries,
  };
}

type CandleReading = Pick<AssetReading, "session" | "close" | "trend" | "momentum" | "range"> & {
  truncated: TruncationReport[];
};

function computeCandleReading(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): Result<CandleReading> {
  const candleSeries = buildCandleSeries({
    candles: view.candles,
    corporateActions: view.corporateActions,
    ticker,
    timeframe: "D1",
    at,
  });
  if (!candleSeries.ok) {
    return { ok: false, error: invalidInput(candleSeries.error.path, candleSeries.error.message) };
  }
  const truncated = candleSeries.value.truncated;
  const empty: CandleReading = {
    session: null,
    close: null,
    trend: { label: null, smaShort: null, smaLong: null },
    momentum: { label: null, rsi: null },
    range: { label: null, atr: null, atrShare: null },
    truncated,
  };

  const candles = candleSeries.value.adjusted;
  if (candles.length === 0) return { ok: true, value: empty };

  const position = candles.length - 1;
  const latest = candles[position];
  if (!latest) return { ok: true, value: empty };
  const calendar = tradingCalendar(view.calendar);
  const windowEnd = windowEndFor(view, latest.session, at);
  const closes = candles.map((c) => parseDecimal(c.close));

  const smaShortSeries = sma(closes, assetReadingThresholds.smaShortLength).map((v) =>
    v ? toDecimalString(v, PRICE_SCALE) : null,
  );
  const smaLongSeries = sma(closes, assetReadingThresholds.smaLongLength).map((v) =>
    v ? toDecimalString(v, PRICE_SCALE) : null,
  );
  const smaShort = readingAt(
    { kind: "sma", length: assetReadingThresholds.smaShortLength },
    smaShortSeries,
    candles,
    position,
    calendar,
    "D1",
    windowEnd,
    neverRankedIvSessions,
  );
  const smaLong = readingAt(
    { kind: "sma", length: assetReadingThresholds.smaLongLength },
    smaLongSeries,
    candles,
    position,
    calendar,
    "D1",
    windowEnd,
    neverRankedIvSessions,
  );
  const rsiValue = readingAt(
    { kind: "rsi", length: assetReadingThresholds.rsiLength },
    [],
    candles,
    position,
    calendar,
    "D1",
    windowEnd,
    neverRankedIvSessions,
  );
  const atrValue = readingAt(
    { kind: "atr", length: assetReadingThresholds.atrLength },
    [],
    candles,
    position,
    calendar,
    "D1",
    windowEnd,
    neverRankedIvSessions,
  );
  const atrShare =
    atrValue !== null
      ? toDecimalString(parseDecimal(atrValue).div(parseDecimal(latest.close)), RATIO_SCALE)
      : null;

  return {
    ok: true,
    value: {
      session: latest.session,
      close: latest.close,
      trend: {
        label: classifyTrend(latest.close, smaShort, smaLong),
        smaShort,
        smaLong,
      },
      momentum: { label: classifyMomentum(rsiValue), rsi: rsiValue },
      range: { label: classifyRange(atrShare), atr: atrValue, atrShare },
      truncated: candleSeries.value.truncated,
    },
  };
}

type ImpliedVolatilityReading = {
  reading: AssetReading["impliedVolatility"];
  truncated: TruncationReport[];
};

function computeImpliedVolatilityReading(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
): Result<ImpliedVolatilityReading> {
  const ivSeries = buildIvIndexSeries({
    points: view.impliedVolatilityIndex,
    underlying: ticker,
    at,
  });
  if (!ivSeries.ok) {
    return { ok: false, error: invalidInput(ivSeries.error.path, ivSeries.error.message) };
  }
  const truncated = ivSeries.value.truncated;
  const points = ivSeries.value.points;
  const latestPoint = points.at(-1) ?? null;
  if (latestPoint === null) {
    return { ok: true, value: { reading: { label: null, ivRank: null, latest: null }, truncated } };
  }

  const lookback = assetReadingThresholds.ivRankLookbackSessions;
  const values = points.map((p) => parseDecimal(p.impliedVolatility));
  const rankSeries = ivRank(values, lookback).map((v) =>
    v ? toDecimalString(v, RATIO_SCALE) : null,
  );
  const sessions = points.map((p) => p.session);
  const windowEnd = windowEndFor(view, latestPoint.session, at);
  const ivRankValue = readingAt(
    { kind: "iv_rank", lookbackSessions: lookback },
    rankSeries,
    [],
    points.length - 1,
    tradingCalendar(view.calendar),
    "D1",
    windowEnd,
    () => sessions,
  );

  return {
    ok: true,
    value: {
      reading: {
        label: classifyImpliedVolatility(ivRankValue),
        ivRank: ivRankValue,
        latest: { session: latestPoint.session, impliedVolatility: latestPoint.impliedVolatility },
      },
      truncated,
    },
  };
}

// ADR-0059: one deterministic reading of a single ticker, computed purely from the engine's
// existing candle/IV/option-series machinery, labeled by this project's default thresholds. No
// invalid_input is raised for "not enough history" or "no options listed" - only for a
// structurally broken view (ADR-0013's existing invalid_input pattern); those read as nulls.
export function computeAssetReading(
  view: MarketView,
  ticker: Ticker,
  at: Instant,
  provenanceBase: ProvenanceBase,
): Result<AssetReading> {
  const integrityError = validateViewIntegrity(view);
  if (integrityError) return err(integrityError);

  const candleReading = computeCandleReading(view, ticker, at);
  if (!candleReading.ok) return err(candleReading.error);

  const impliedVolatility = computeImpliedVolatilityReading(view, ticker, at);
  if (!impliedVolatility.ok) return err(impliedVolatility.error);

  const options = computeOptionsReading(view, ticker, at, candleReading.value.session);

  return {
    ok: true,
    value: {
      ticker,
      session: candleReading.value.session,
      close: candleReading.value.close,
      trend: candleReading.value.trend,
      momentum: candleReading.value.momentum,
      range: candleReading.value.range,
      impliedVolatility: impliedVolatility.value.reading,
      options,
      thresholds: assetReadingThresholds,
      notes: [],
      provenance: {
        ...provenanceBase,
        truncated: [...candleReading.value.truncated, ...impliedVolatility.value.truncated],
      },
    },
  };
}
