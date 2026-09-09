import { unzipSync } from "fflate";

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
// section 2). The zip holds a single fixed-width .TXT with the same name,
// latin1-encoded (accented instrument names).
export function cotahistDailyFileUrl(session: string): string {
  const [year = "", month = "", day = ""] = session.split("-");
  return `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D${day}${month}${year}.ZIP`;
}

function decompressCotahist(zipBytes: Uint8Array): string {
  const entries = unzipSync(zipBytes);
  const [name, bytes] = Object.entries(entries)[0] ?? [];
  if (!name || !bytes) {
    throw new CotahistFetchError("COTAHIST zip has no entries");
  }
  return new TextDecoder("latin1").decode(bytes);
}

export async function fetchCotahist(
  session: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CotahistRow[]> {
  const response = await fetchImpl(cotahistDailyFileUrl(session));
  if (!response.ok) {
    throw new CotahistFetchError(`COTAHIST fetch failed for ${session}`, response.status);
  }
  const zipBytes = new Uint8Array(await response.arrayBuffer());
  const content = decompressCotahist(zipBytes);
  return parseCotahist(content, session);
}
