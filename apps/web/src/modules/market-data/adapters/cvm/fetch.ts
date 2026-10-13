import { unzipSync } from "fflate";

import type { ParsedCompanyFilings, ParsedCompanyTickers } from "./parser";
import { parseFcaTickers, parseIpeFilings } from "./parser";

export class CvmFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CvmFetchError";
  }
}

const CVM_OPEN_DATA = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC";
const REQUEST_TIMEOUT_MS = 30_000;
// The 2026 IPE zip is 1.7 MB and inflates to 15 MB; these bounds are an
// order of magnitude above that, so only a broken or hostile answer hits them.
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

export function ipeFileUrl(year: number): string {
  return `${CVM_OPEN_DATA}/IPE/DADOS/ipe_cia_aberta_${String(year)}.zip`;
}

export function fcaFileUrl(year: number): string {
  return `${CVM_OPEN_DATA}/FCA/DADOS/fca_cia_aberta_${String(year)}.zip`;
}

// `null` when CVM has not generated that year's file yet (404), which is
// expected for the current year in its first days.
async function fetchZipEntry(
  url: string,
  entryName: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new CvmFetchError(`CVM fetch failed for ${entryName}`, response.status);
  }
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ZIP_BYTES) {
    throw new CvmFetchError(`CVM zip for ${entryName} is too large`);
  }
  const zipBytes = new Uint8Array(await response.arrayBuffer());
  if (zipBytes.byteLength > MAX_ZIP_BYTES) {
    throw new CvmFetchError(`CVM zip for ${entryName} is too large`);
  }
  const entries = unzipSync(zipBytes, {
    filter: (file) => file.name === entryName && file.originalSize <= MAX_ENTRY_BYTES,
  });
  const bytes = entries[entryName];
  if (!bytes) {
    throw new CvmFetchError(`CVM zip has no usable ${entryName}`);
  }
  return new TextDecoder("latin1").decode(bytes);
}

export async function fetchIpeFilings(
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedCompanyFilings | null> {
  const content = await fetchZipEntry(
    ipeFileUrl(year),
    `ipe_cia_aberta_${String(year)}.csv`,
    fetchImpl,
  );
  return content === null ? null : parseIpeFilings(content);
}

export async function fetchFcaTickers(
  year: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedCompanyTickers | null> {
  const content = await fetchZipEntry(
    fcaFileUrl(year),
    `fca_cia_aberta_valor_mobiliario_${String(year)}.csv`,
    fetchImpl,
  );
  return content === null ? null : parseFcaTickers(content);
}
