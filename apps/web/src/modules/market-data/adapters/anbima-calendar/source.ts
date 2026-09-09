import type { ParsedTradingSession } from "./schema";
import holidaysFile from "./anbima-national-holidays.json";
import { buildTradingSessions, holidaysForYear, parseHolidaysFile } from "./parser";

// Parsed once from the real ANBIMA feriados_nacionais.xls (2001-2099,
// downloaded 2026-09-09, docs/adr/0017) with a scratch python/xlrd script and
// committed here — ANBIMA ships an .xls, not an API, so there is nothing to
// fetch at ingestion time.
const holidays = parseHolidaysFile(holidaysFile);

export function tradingSessionsForYear(year: number): ParsedTradingSession[] {
  return buildTradingSessions(year, holidaysForYear(holidays, year));
}
