import Decimal from "decimal.js";
import { positiveDecimalSchema } from "@fetha/contracts";

import { indexPortfolioDayResponseSchema, monthColumns } from "./schema";
import type { IndexClosePoint, IndexDayRow } from "./schema";

// B3's own Brazilian number format, strictly: 1 to 3 digits, then zero or more
// exactly-3-digit thousands groups, then an optional comma decimal part. An
// en-US `209066.90` fails this (the digits before its lone "." are not a
// 1-3-digit group), as does "N/D", "NaN", "Infinity" or a leading "-" (#289:
// never let a provider string reach `Decimal`'s own constructor, which quotes
// its input verbatim in the thrown message).
const BRAZILIAN_NUMBER_PATTERN = /^\d{1,3}(\.\d{3})*(,\d+)?$/;

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
// separator and decimal comma (ADR-0062). `date` never reaches the thrown message: only the
// provider's own text would (#289), and it is never trustworthy once it has failed the format
// check below.
function parseBrazilianNumber(value: string, date: string): Decimal {
  const trimmed = value.trim();
  if (!BRAZILIAN_NUMBER_PATTERN.test(trimmed)) {
    throw new Error(`B3 index statistics returned a non-numeric value for ${date}`);
  }
  const normalized = trimmed.replaceAll(".", "").replace(",", ".");
  const positive = positiveDecimalSchema.safeParse(normalized);
  if (!positive.success) {
    throw new Error(`B3 index statistics returned a non-numeric value for ${date}`);
  }
  return new Decimal(positive.data);
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
      const date = isoDate(year, month, row.day);
      points.push({
        date,
        close: parseBrazilianNumber(raw, date).toFixed(6),
      });
    }
  }
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
