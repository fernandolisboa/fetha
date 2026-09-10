import type { Holiday, ParsedTradingSession } from "./schema";
import { holidaysFileSchema, tradingSessionSchema } from "./schema";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "20:00:00.000Z";
const SATURDAY = 6;
const SUNDAY = 0;
const MINIMUM_HOLIDAYS_PER_YEAR = 8;

export class CalendarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarValidationError";
  }
}

export function parseHolidaysFile(content: unknown): Holiday[] {
  return holidaysFileSchema.parse(content);
}

// B3 also closes Dec 24 and Dec 31 every year, which ANBIMA's national
// holiday file (bank holidays only) does not list (docs/adr/0017).
function b3ExtraClosures(year: number): string[] {
  return [`${String(year)}-12-24`, `${String(year)}-12-31`];
}

export function holidaysForYear(allHolidays: Holiday[], year: number): string[] {
  const prefix = `${String(year)}-`;
  const anbima = allHolidays.filter((holiday) => holiday.date.startsWith(prefix));
  if (anbima.length < MINIMUM_HOLIDAYS_PER_YEAR) {
    throw new CalendarValidationError(
      `year ${String(year)} has only ${String(anbima.length)} ANBIMA holidays, expected at least ${String(MINIMUM_HOLIDAYS_PER_YEAR)}`,
    );
  }
  return [...anbima.map((holiday) => holiday.date), ...b3ExtraClosures(year)];
}

// Every weekday not in `holidays` is a full trading session, open 13:00Z
// (10:00 America/Sao_Paulo) to 20:00Z (17:00 America/Sao_Paulo). This is a
// documented simplification (ADR-0017): B3's own half-day sessions (Ash
// Wednesday afternoon) are not modeled; every session this function produces
// has the regular full-day open/close.
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
