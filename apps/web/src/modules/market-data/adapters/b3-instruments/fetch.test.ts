import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { InstrumentsFetchError, fetchInstrumentsRegistry, instrumentsRegistryUrl } from "./fetch";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"),
  "utf-8",
);

function fakeFetch(status: number, body: string): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

describe("instrumentsRegistryUrl", () => {
  it("builds the B3 InstrumentsConsolidated URL for a report date", () => {
    expect(instrumentsRegistryUrl("2026-09-08")).toBe(
      "https://arquivos.b3.com.br/tabelas/InstrumentsConsolidated/2026-09-08?lang=pt",
    );
  });
});

describe("fetchInstrumentsRegistry", () => {
  it("parses the response body through the registry CSV parser", async () => {
    const series = await fetchInstrumentsRegistry("2026-09-08", fakeFetch(200, fixture));
    expect(series).toHaveLength(2);
  });

  it("throws InstrumentsFetchError on a non-ok response", async () => {
    await expect(fetchInstrumentsRegistry("2026-09-08", fakeFetch(500, ""))).rejects.toThrow(
      InstrumentsFetchError,
    );
  });
});
