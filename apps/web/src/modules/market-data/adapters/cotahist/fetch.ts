import { unzipSync } from "fflate";

import type { CotahistRow } from "./schema";
import { parseCotahist, RECORD_LENGTH } from "./parser";

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

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8", { fatal: true });

// COTAHIST_D22102026 carries one record whose name B3 wrote in UTF-8 ("OCEÂNI" as C3 82) inside
// the latin1 file, one byte past the fixed width, and one such line used to fail the whole
// session. A line that is not RECORD_LENGTH wide in latin1 is read as UTF-8 instead when that
// gives the fixed width back; anything else is left for the parser to reject.
function decodeLine(bytes: Uint8Array): string {
  const text = latin1.decode(bytes);
  if (text.length === RECORD_LENGTH) return text;
  try {
    const asUtf8 = utf8.decode(bytes);
    return asUtf8.length === RECORD_LENGTH ? asUtf8 : text;
  } catch {
    return text;
  }
}

function decodeCotahist(bytes: Uint8Array): string {
  const lines: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline === -1 ? bytes.length : newline;
    const lineEnd = end > start && bytes[end - 1] === 0x0d ? end - 1 : end;
    lines.push(decodeLine(bytes.subarray(start, lineEnd)));
    start = end + 1;
  }
  return lines.join("\n");
}

function decompressCotahist(zipBytes: Uint8Array): string {
  const entries = unzipSync(zipBytes);
  const [name, bytes] = Object.entries(entries)[0] ?? [];
  if (!name || !bytes) {
    throw new CotahistFetchError("COTAHIST zip has no entries");
  }
  return decodeCotahist(bytes);
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
