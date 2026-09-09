import type { ParsedTradingSession } from "./schema";
import { buildTradingSessions, parseHolidays } from "./parser";

export class CalendarFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CalendarFetchError";
  }
}

// docs/research/2026-09-02-market-data-providers.md, section 6: published
// yearly, in December for the following year.
export function anbimaCalendarUrl(year: number): string {
  return `https://www.anbima.com.br/feriados/arqs/feriados_nacionais.csv?ano=${String(year)}`;
}

export async function fetchTradingSessions(
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedTradingSession[]> {
  const response = await fetchImpl(anbimaCalendarUrl(year));
  if (!response.ok) {
    throw new CalendarFetchError(
      `ANBIMA calendar fetch failed for ${String(year)}`,
      response.status,
    );
  }
  const content = await response.text();
  const holidays = parseHolidays(content);
  return buildTradingSessions(year, holidays);
}
