import type { InstrumentOptionSeries } from "./schema";
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

// docs/research/2026-09-02-market-data-providers.md, section 3.
export function instrumentsRegistryUrl(reportDate: string): string {
  return `https://arquivos.b3.com.br/tabelas/InstrumentsConsolidated/${reportDate}?lang=pt`;
}

export async function fetchInstrumentsRegistry(
  reportDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstrumentOptionSeries[]> {
  const response = await fetchImpl(instrumentsRegistryUrl(reportDate));
  if (!response.ok) {
    throw new InstrumentsFetchError(
      `instruments registry fetch failed for ${reportDate}`,
      response.status,
    );
  }
  const content = await response.text();
  return parseInstrumentsRegistry(content);
}
