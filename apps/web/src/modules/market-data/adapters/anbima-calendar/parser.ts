import type { ParsedTradingSession } from "./schema";
import { tradingSessionSchema } from "./schema";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "20:00:00.000Z";
const SATURDAY = 6;
const SUNDAY = 0;

function toIsoDate(ddmmyyyy: string): string {
  const [day = "", month = "", year = ""] = ddmmyyyy.split("/");
  return `${year}-${month}-${day}`;
}

// ANBIMA's holiday spreadsheet lists non-trading days only
// (docs/research/2026-09-02-market-data-providers.md, section 6). This parser
// extracts the `Data` column as ISO holiday dates; building the full session
// calendar for a year is `buildTradingSessions` below.
export function parseHolidays(content: string): string[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((row) => toIsoDate(row.split(";")[0] ?? ""));
}

// Every weekday not in `holidays` is a full trading session, open 13:00Z
// (10:00 America/Sao_Paulo) to 20:00Z (17:00 America/Sao_Paulo). This is a
// documented simplification (ADR-0017): B3's own half-day sessions (Ash
// Wednesday afternoon, Dec 24/31 shortened hours) are not modeled; every
// session this function produces has the regular full-day open/close.
export function buildTradingSessions(year: number, holidays: string[]): ParsedTradingSession[] {
  const holidaySet = new Set(holidays);
  const sessions: ParsedTradingSession[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));

  while (cursor.getUTCFullYear() === year) {
    const isoDate = cursor.toISOString().slice(0, 10);
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek !== SATURDAY && dayOfWeek !== SUNDAY && !holidaySet.has(isoDate)) {
      sessions.push(
        tradingSessionSchema.parse({
          date: isoDate,
          open: `${isoDate}T${SESSION_OPEN_UTC}`,
          close: `${isoDate}T${SESSION_CLOSE_UTC}`,
        }),
      );
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return sessions;
}
