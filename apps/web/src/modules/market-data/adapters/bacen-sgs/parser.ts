import Decimal from "decimal.js";

import type { MacroPoint, MacroSeriesKind } from "./schema";
import { macroPointSchema, sgsResponseSchema } from "./schema";

const TRADING_SESSIONS_PER_YEAR = 252;

export interface SessionOpen {
  date: string;
  open: string;
}

function toIsoDate(ddmmyyyy: string): string {
  const [day = "", month = "", year = ""] = ddmmyyyy.split("/");
  return `${year}-${month}-${day}`;
}

function compoundToAnnual(rate: Decimal, periodsPerYear: number): Decimal {
  return rate.dividedBy(100).plus(1).pow(periodsPerYear).minus(1);
}

// ADR-0013's ln(1 + cdi) consumes annualRate as a fraction (0.14 for 14%
// a.a.), not a percent; every branch below returns a fraction.
export function convertToAnnualRate(series: MacroSeriesKind, value: string): string {
  const decimal = new Decimal(value);
  if (series === "cdi") {
    return compoundToAnnual(decimal, TRADING_SESSIONS_PER_YEAR).toFixed(8);
  }
  // selic (432, meta) and ipca (13522, 12-month accumulated) are both
  // already annual rates in percent; converting to a fraction is the only
  // transform applied.
  return decimal.dividedBy(100).toFixed(8);
}

function nextSessionStrictlyAfter(date: string, sessions: SessionOpen[]): SessionOpen {
  const found = sessions.find((session) => session.date > date);
  if (!found) {
    throw new Error(`no trading session found after ${date}: calendar coverage gap`);
  }
  return found;
}

function sessionOnOrAfter(date: string, sessions: SessionOpen[]): SessionOpen {
  const found = sessions.find((session) => session.date >= date);
  if (!found) {
    throw new Error(`no trading session found on or after ${date}: calendar coverage gap`);
  }
  return found;
}

function sessionOf(date: string, sessions: SessionOpen[]): SessionOpen {
  const found = sessions.find((session) => session.date === date);
  if (!found) {
    throw new Error(`no trading session found for ${date}: calendar coverage gap`);
  }
  return found;
}

function fifteenthOfNextMonth(isoDate: string): string {
  const [year = "0", month = "1"] = isoDate.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month), 15));
  return date.toISOString().slice(0, 10);
}

function earliestSessionDate(sessions: SessionOpen[]): string | undefined {
  return sessions.reduce<string | undefined>(
    (earliest, session) =>
      earliest === undefined || session.date < earliest ? session.date : earliest,
    undefined,
  );
}

// ADR-0017: a macro point's asOf is its publication instant (ADR-0013), not
// the reference date's open, which would let evaluations see the rate before
// it exists. cdi (12) and the (currently unfetched) Selic daily series (11)
// are known only from the next session; the Selic target (432) takes effect
// from the reference date's own session open; IPCA (13522, 12-month
// accumulated) is published roughly mid-month for the previous month, so it
// becomes visible at the first session on or after the 15th of the month
// following the reference month.
//
// The coverage guard below checks the *lookup target* each series actually
// resolves against, not the raw reference `date`: for ipca that target is
// already a month or more forward of `date` (fifteenthOfNextMonth), so the
// very first ipca point of a fresh calendar (dated the first day of the
// first ingested year) legitimately resolves forward into that calendar's
// coverage even though the reference date itself precedes it (docs/adr/0017)
// — checking the raw date there made the first-ever SGS run on a fresh
// database fail forever. For cdi and selic the target is `date` itself (or
// the next session after it), so an old backfill date is still rejected
// instead of silently resolving to the first modern session in `sessions`,
// which is the look-ahead leak this guard exists to prevent.
export function resolveAsOfInstant(
  series: MacroSeriesKind,
  date: string,
  sessions: SessionOpen[],
): string {
  const earliest = earliestSessionDate(sessions);
  const target = series === "ipca" ? fifteenthOfNextMonth(date) : date;
  if (earliest !== undefined && target < earliest) {
    throw new Error(
      `${date} precedes the first recorded trading session (${earliest}): calendar coverage does not reach back this far`,
    );
  }
  if (series === "cdi") {
    return nextSessionStrictlyAfter(date, sessions).open;
  }
  if (series === "ipca") {
    return sessionOnOrAfter(target, sessions).open;
  }
  return sessionOf(date, sessions).open;
}

export function parseSgsResponse(
  series: MacroSeriesKind,
  body: unknown,
  sessions: SessionOpen[],
): MacroPoint[] {
  const sessionDates = new Set(sessions.map((session) => session.date));
  const points = sgsResponseSchema
    .parse(body)
    .filter((point) => point.valor.trim() !== "")
    // Series 432 (Selic target) is published for every calendar day,
    // repeating the same rate over weekends and holidays; asOf for selic
    // requires the reference date to be a session (ADR-0017), so a
    // non-session duplicate carries nothing a session-day point doesn't
    // already give and is dropped rather than treated as a calendar gap.
    .filter((point) => series !== "selic" || sessionDates.has(toIsoDate(point.data)));
  return points.map((point) => {
    const date = toIsoDate(point.data);
    return macroPointSchema.parse({
      series,
      date,
      asOf: resolveAsOfInstant(series, date, sessions),
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
