import { z } from "zod";

import type { ParsedInstrumentsRegistry } from "./parser";
import { parseInstrumentsRegistry } from "./parser";

export class InstrumentsFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "InstrumentsFetchError";
  }
}

// Verified 2026-09-09 (docs/adr/0017): the SPA URL serves HTML, not CSV. B3's
// real flow is a two-step download token exchange.
export function requestNameUrl(reportDate: string): string {
  return `https://arquivos.b3.com.br/api/download/requestname?fileName=InstrumentsConsolidatedFile&date=${reportDate}&recaptchaToken=`;
}

export function downloadUrl(token: string): string {
  return `https://arquivos.b3.com.br/api/download/?token=${token}`;
}

const requestNameResponseSchema = z.object({ token: z.string().min(1) });

export async function fetchInstrumentsRegistry(
  reportDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedInstrumentsRegistry> {
  const tokenResponse = await fetchImpl(requestNameUrl(reportDate));
  if (!tokenResponse.ok) {
    throw new InstrumentsFetchError(
      `instruments registry token request failed for ${reportDate}`,
      tokenResponse.status,
    );
  }
  const tokenBody: unknown = await tokenResponse.json();
  const { token } = requestNameResponseSchema.parse(tokenBody);

  const downloadResponse = await fetchImpl(downloadUrl(token));
  if (!downloadResponse.ok) {
    throw new InstrumentsFetchError(
      `instruments registry download failed for ${reportDate}`,
      downloadResponse.status,
    );
  }
  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const content = new TextDecoder("latin1").decode(bytes);
  return parseInstrumentsRegistry(content);
}
