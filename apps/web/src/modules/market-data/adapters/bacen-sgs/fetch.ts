import type { MacroPoint, MacroSeriesKind } from "./schema";
import { parseSgsResponse, splitIntoTenYearWindows } from "./parser";
import { sgsSeriesCodes } from "./schema";

export class SgsFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SgsFetchError";
  }
}

function toBrDate(isoDate: string): string {
  const [year = "", month = "", day = ""] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

// docs/research/2026-09-02-market-data-providers.md, section 5: the API
// enforces a 10-year window per request as of March 2025.
export function sgsUrl(series: MacroSeriesKind, from: string, to: string): string {
  const code = sgsSeriesCodes[series];
  const params = new URLSearchParams({
    formato: "json",
    dataInicial: toBrDate(from),
    dataFinal: toBrDate(to),
  });
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${String(code)}/dados?${params.toString()}`;
}

export async function fetchSgsSeries(
  series: MacroSeriesKind,
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MacroPoint[]> {
  const windows = splitIntoTenYearWindows(from, to);
  const results: MacroPoint[] = [];
  for (const window of windows) {
    const response = await fetchImpl(sgsUrl(series, window.from, window.to));
    if (!response.ok) {
      throw new SgsFetchError(`SGS fetch failed for series ${series}`, response.status);
    }
    const body: unknown = await response.json();
    results.push(...parseSgsResponse(series, body));
  }
  return results;
}
