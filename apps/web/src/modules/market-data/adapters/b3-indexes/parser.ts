import Decimal from "decimal.js";

import { indexPortfolioDayResponseSchema, monthColumns } from "./schema";
import type { IndexClosePoint, IndexDayRow } from "./schema";

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${String(year)}-${mm}-${dd}`;
}

// "160.538,69" -> "160538.69": B3's own Brazilian number format, thousands
// separator and decimal comma (ADR-0062).
function parseBrazilianNumber(value: string): Decimal {
  const normalized = value.trim().replaceAll(".", "").replace(",", ".");
  return new Decimal(normalized);
}

function closeAtDay(row: IndexDayRow, month: number): string | null | undefined {
  const column = monthColumns[month - 1];
  return column ? row[column] : undefined;
}

// Brazilian number -> `Decimal(...).toFixed(6)`, `null` days skipped, `results: null` -> `[]`
// (ADR-0062). A non-null value on an impossible calendar date (e.g. day
// 31 of a 30-day month) throws without any provider text in the message (#289): the index
// statistics service always answers 31 rows regardless of the month's real length, so a month
// column populated past its own last day is a parsing bug, not something to surface verbatim.
export function parseIndexYear(year: number, body: unknown): IndexClosePoint[] {
  const parsed = indexPortfolioDayResponseSchema.parse(body);
  if (parsed.results === null) {
    return [];
  }

  const points: IndexClosePoint[] = [];
  for (const row of parsed.results) {
    for (let month = 1; month <= 12; month += 1) {
      const raw = closeAtDay(row, month);
      if (raw === null || raw === undefined || raw.trim() === "") {
        continue;
      }
      if (!isValidCalendarDate(year, month, row.day)) {
        throw new Error(`B3 index statistics returned a value for an impossible date`);
      }
      points.push({
        date: isoDate(year, month, row.day),
        close: parseBrazilianNumber(raw).toFixed(6),
      });
    }
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
