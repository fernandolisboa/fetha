import Decimal from "decimal.js";
import type { Instant, SessionDate, Ticker } from "@fetha/contracts";
import type {
  EngineError,
  ImpliedVolatilityIndex,
  MarketView,
  OptionSeries,
  Provenance,
  Result,
} from "../api";
import { sessionAtOrBefore, sortedCalendar } from "./calendar";
import { RATIO_SCALE, toDecimalString } from "./decimal";
import { solveImpliedVolatilityRaw } from "./implied-volatility";
import { resolveDividendYield, resolveRiskFreeRate } from "./rates";
import { resolveLegMarketPrice, resolveUnderlyingSpot } from "./resolve-market-price";
import { collapseSeriesByTicker, isEarlierByStrikeThenTicker } from "./resolve-series";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

const CALENDAR_DAYS_TO_TARGET = 30;

type ProvenanceBase = Pick<
  Provenance,
  "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
>;

function err(error: EngineError): Result<ImpliedVolatilityIndex> {
  return { ok: false, error };
}

function addCalendarDays(date: SessionDate, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

type AtmBracket = { expiry: SessionDate; years: number };
type AtmSolution = { volatility: number; seriesUsed: Ticker[] };

// Order-invariance (I3): `candidates` comes from filtering MarketView.optionSeries, whose row
// order is not meaningful. Reuses the shared strike-then-ticker tie-break so two tickers at
// one strike, or two equidistant strikes, resolve the same series regardless of array order
// (PR #53 round 5 item 1).
function nearestByStrike(
  candidates: readonly OptionSeries[],
  forward: number,
): OptionSeries | null {
  let best: OptionSeries | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const series of candidates) {
    const distance = Math.abs(Number(series.strike) - forward);
    const isBetter =
      distance < bestDistance ||
      (distance === bestDistance && best !== null && isEarlierByStrikeThenTicker(series, best));
    if (isBetter) {
      best = series;
      bestDistance = distance;
    }
  }
  return best;
}

function solveAtmVolatility(
  view: MarketView,
  collapsedSeries: readonly OptionSeries[],
  underlying: Ticker,
  at: Instant,
  expiry: SessionDate,
  years: number,
  spot: number,
  riskFreeRate: number,
  dividendYield: number,
): AtmSolution | null {
  const listed = collapsedSeries.filter(
    (series) => series.underlying === underlying && series.expiry === expiry,
  );
  const forward = spot * Math.exp((riskFreeRate - dividendYield) * years);
  const call = nearestByStrike(
    listed.filter((series) => series.right === "call"),
    forward,
  );
  const put = nearestByStrike(
    listed.filter((series) => series.right === "put"),
    forward,
  );

  const samples: number[] = [];
  const seriesUsed: Ticker[] = [];
  for (const series of [call, put]) {
    if (!series) continue;
    const marketPrice = resolveLegMarketPrice(view, series.ticker, at);
    if (!marketPrice) continue;
    const solved = solveImpliedVolatilityRaw({
      s: spot,
      k: Number(series.strike),
      t: years,
      r: riskFreeRate,
      q: dividendYield,
      right: series.right,
      price: Number(marketPrice.value),
    });
    if (solved.ok) {
      samples.push(solved.sigma);
      seriesUsed.push(series.ticker);
    }
  }

  if (samples.length === 0) return null;
  const volatility = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { volatility, seriesUsed };
}

function notBracketed(
  underlying: Ticker,
  session: SessionDate,
  provenanceBase: ProvenanceBase,
): Result<ImpliedVolatilityIndex> {
  return {
    ok: true,
    value: {
      underlying,
      session,
      impliedVolatility: null,
      method: "atm_30d_variance_interpolated",
      seriesUsed: [],
      notes: [
        {
          code: "iv_index_not_bracketed",
          message: "fewer than two listed expiries bracket 30 calendar days ahead",
        },
      ],
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}

function toResult(
  underlying: Ticker,
  session: SessionDate,
  volatility: number,
  seriesUsed: Ticker[],
  provenanceBase: ProvenanceBase,
): Result<ImpliedVolatilityIndex> {
  return {
    ok: true,
    value: {
      underlying,
      session,
      impliedVolatility: toDecimalString(new Decimal(volatility), RATIO_SCALE),
      method: "atm_30d_variance_interpolated",
      seriesUsed,
      notes: [],
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}

// ADR-0013 "impliedVolatilityIndex" (atm_30d_variance_interpolated): bracket the 30-calendar-day
// point between the two nearest listed expiries and interpolate linearly in total variance
// (Ts^2), which is the standard construction for a fixed-tenor volatility index (cf. VIX).
export function computeImpliedVolatilityIndex(
  view: MarketView,
  underlying: Ticker,
  at: Instant,
  provenanceBase: ProvenanceBase,
): Result<ImpliedVolatilityIndex> {
  const spotValue = resolveUnderlyingSpot(view, underlying, at);
  if (!spotValue) return err({ code: "missing_instrument", ticker: underlying });

  const riskFreeRateResolution = resolveRiskFreeRate(view.macro, at);
  if (!riskFreeRateResolution.ok) return err(riskFreeRateResolution.error);
  const dividendResolution = resolveDividendYield(view.dividendYields, underlying, at);
  if (!dividendResolution.ok) return err(dividendResolution.error);

  const spot = Number(spotValue);
  const riskFreeRate = Number(riskFreeRateResolution.value);
  const dividendYield = Number(dividendResolution.value);

  const calendar = sortedCalendar(view.calendar);
  const atSession = sessionAtOrBefore(calendar, at);
  if (!atSession) {
    return err({
      code: "insufficient_data",
      needed: {
        from: at,
        to: at,
        instruments: [underlying],
        timeframes: [],
        collections: ["candles"],
      },
    });
  }
  const targetDate = addCalendarDays(atSession.date, CALENDAR_DAYS_TO_TARGET);
  const targetSession = calendar.find((session) => session.date >= targetDate) ?? null;
  if (!targetSession) return notBracketed(underlying, atSession.date, provenanceBase);
  // t30 must share the exact-tenor basis with every bracket below (resolveTimeToExpiryYears,
  // which includes the intraday (1 - f) term): a whole-session count here bracketed the same
  // view differently at the session's open than at its close (PR #53 round 3 item 2).
  const t30Resolution = resolveTimeToExpiryYears(view.calendar, at, targetSession.date);
  if (!t30Resolution.ok) return notBracketed(underlying, atSession.date, provenanceBase);
  const t30 = t30Resolution.years;

  const collapsedSeries = collapseSeriesByTicker(view.optionSeries, at);
  const listedExpiries = [
    ...new Set(
      collapsedSeries
        .filter((series) => series.underlying === underlying)
        .map((series) => series.expiry),
    ),
  ];

  const brackets: AtmBracket[] = [];
  for (const expiry of listedExpiries) {
    const tte = resolveTimeToExpiryYears(view.calendar, at, expiry);
    if (tte.ok) brackets.push({ expiry, years: tte.years });
  }
  brackets.sort((a, b) => a.years - b.years);

  const solve = (bracket: AtmBracket): AtmSolution | null =>
    solveAtmVolatility(
      view,
      collapsedSeries,
      underlying,
      at,
      bracket.expiry,
      bracket.years,
      spot,
      riskFreeRate,
      dividendYield,
    );

  const exact = brackets.find((b) => Math.abs(b.years - t30) < 1e-12);
  if (exact) {
    const solved = solve(exact);
    if (!solved) return notBracketed(underlying, atSession.date, provenanceBase);
    return toResult(
      underlying,
      atSession.date,
      solved.volatility,
      solved.seriesUsed,
      provenanceBase,
    );
  }

  let lower: AtmBracket | null = null;
  let upper: AtmBracket | null = null;
  for (const bracket of brackets) {
    if (bracket.years <= t30) lower = bracket;
    if (bracket.years > t30 && !upper) upper = bracket;
  }
  if (!lower || !upper) return notBracketed(underlying, atSession.date, provenanceBase);

  const solvedLower = solve(lower);
  const solvedUpper = solve(upper);
  if (!solvedLower || !solvedUpper) return notBracketed(underlying, atSession.date, provenanceBase);

  const w = (upper.years - t30) / (upper.years - lower.years);
  const variance =
    (w * solvedLower.volatility ** 2 * lower.years +
      (1 - w) * solvedUpper.volatility ** 2 * upper.years) /
    t30;

  return toResult(
    underlying,
    atSession.date,
    Math.sqrt(variance),
    [...solvedLower.seriesUsed, ...solvedUpper.seriesUsed],
    provenanceBase,
  );
}
