import type { CotahistRow } from "./schema";
import { parseCotahist } from "./parser";

export class CotahistFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CotahistFetchError";
  }
}

// B3 publishes the daily COTAHIST file as COTAHIST_D{ddmmyyyy}.ZIP under
// InstDados/SerHist (docs/research/2026-09-02-market-data-providers.md,
// section 2). The zip holds a single fixed-width .TXT with the same name.
// `fetchImpl` is expected to return the already-decompressed .TXT content
// (unzipping is an ingestion-runtime concern, not the parser's); tests inject
// a fake that returns fixture text directly, matching that contract.
export function cotahistDailyFileUrl(session: string): string {
  const [year = "", month = "", day = ""] = session.split("-");
  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${day}${month}${year}.ZIP`;
}

export async function fetchCotahist(
  session: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CotahistRow[]> {
  const response = await fetchImpl(cotahistDailyFileUrl(session));
  if (!response.ok) {
    throw new CotahistFetchError(`COTAHIST fetch failed for ${session}`, response.status);
  }
  const content = await response.text();
  return parseCotahist(content);
}
