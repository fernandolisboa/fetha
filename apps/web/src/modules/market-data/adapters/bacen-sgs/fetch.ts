import type { SessionOpen } from "./parser";
import { parseSgsResponse, splitIntoTenYearWindows } from "./parser";
import type { MacroPoint, MacroSeriesKind } from "./schema";
import { sgsNotFoundBodySchema, sgsSeriesCodes } from "./schema";

export class SgsFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SgsFetchError";
  }
}

// SGS answers a date range that holds no value yet with this 404 body
// (reproduced 2026-09-28, #216), e.g. the CDI of a session Bacen has not
// published by the time the nightly cron runs. Any other 404 stays an error.
export class SgsNotPublishedError extends SgsFetchError {
  constructor(series: MacroSeriesKind) {
    super(`SGS has no value yet for series ${series} in the requested range`, 404);
    this.name = "SgsNotPublishedError";
  }
}

async function isNotPublishedResponse(response: Response): Promise<boolean> {
  if (response.status !== 404) {
    return false;
  }
  const body: unknown = await response.json().catch(() => undefined);
  return sgsNotFoundBodySchema.safeParse(body).success;
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
  sessions: SessionOpen[],
  fetchImpl: typeof fetch = fetch,
): Promise<MacroPoint[]> {
  const windows = splitIntoTenYearWindows(from, to);
  const results: MacroPoint[] = [];
  for (const window of windows) {
    const response = await fetchImpl(sgsUrl(series, window.from, window.to));
    if (await isNotPublishedResponse(response)) {
      throw new SgsNotPublishedError(series);
    }
    if (!response.ok) {
      throw new SgsFetchError(`SGS fetch failed for series ${series}`, response.status);
    }
    const body: unknown = await response.json();
    results.push(...parseSgsResponse(series, body, sessions));
  }
  return results;
}
