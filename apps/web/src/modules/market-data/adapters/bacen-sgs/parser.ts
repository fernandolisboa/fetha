import Decimal from "decimal.js";

import type { MacroPoint, MacroSeriesKind } from "./schema";
import { macroPointSchema, sgsResponseSchema } from "./schema";

const TRADING_SESSIONS_PER_YEAR = 252;
const MONTHS_PER_YEAR = 12;

function toIsoDate(ddmmyyyy: string): string {
  const [day = "", month = "", year = ""] = ddmmyyyy.split("/");
  return `${year}-${month}-${day}`;
}

function sessionOpenInstant(isoDate: string): string {
  // ADR-0017: a macro point's asOf is its publication session's open, so it
  // is visible to any evaluation from the start of the session it describes.
  return `${isoDate}T13:00:00.000Z`;
}

function compoundToAnnual(rate: Decimal, periodsPerYear: number): Decimal {
  return rate.dividedBy(100).plus(1).pow(periodsPerYear).minus(1).times(100);
}

export function convertToAnnualRate(series: MacroSeriesKind, value: string): string {
  const decimal = new Decimal(value);
  if (series === "cdi") {
    return compoundToAnnual(decimal, TRADING_SESSIONS_PER_YEAR).toFixed(8);
  }
  if (series === "ipca") {
    return compoundToAnnual(decimal, MONTHS_PER_YEAR).toFixed(8);
  }
  return decimal.toFixed(8);
}

export function parseSgsResponse(series: MacroSeriesKind, body: unknown): MacroPoint[] {
  const points = sgsResponseSchema.parse(body);
  return points.map((point) => {
    const date = toIsoDate(point.data);
    return macroPointSchema.parse({
      series,
      date,
      asOf: sessionOpenInstant(date),
      annualRate: convertToAnnualRate(series, point.valor),
    });
  });
}

const MAX_WINDOW_YEARS = 10;

export function splitIntoTenYearWindows(
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  const windows: Array<{ from: string; to: string }> = [];
  let windowStart = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (windowStart <= end) {
    const windowEndCandidate = new Date(windowStart);
    windowEndCandidate.setUTCFullYear(windowEndCandidate.getUTCFullYear() + MAX_WINDOW_YEARS);
    windowEndCandidate.setUTCDate(windowEndCandidate.getUTCDate() - 1);
    const windowEnd = windowEndCandidate > end ? end : windowEndCandidate;

    windows.push({
      from: windowStart.toISOString().slice(0, 10),
      to: windowEnd.toISOString().slice(0, 10),
    });

    const nextStart = new Date(windowEnd);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    windowStart = nextStart;
  }

  return windows;
}
