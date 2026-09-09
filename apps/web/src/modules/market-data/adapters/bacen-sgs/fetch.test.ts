import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SgsFetchError, fetchSgsSeries, sgsUrl } from "./fetch";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "sgs-cdi-sample.json"),
  "utf-8",
);

function fakeFetch(status: number, body: string): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

describe("sgsUrl", () => {
  it("builds the SGS URL with dd/mm/yyyy dates and the series code", () => {
    expect(sgsUrl("cdi", "2026-01-01", "2026-09-08")).toBe(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01%2F01%2F2026&dataFinal=08%2F09%2F2026",
    );
  });
});

describe("fetchSgsSeries", () => {
  it("parses the response through the SGS JSON parser", async () => {
    const points = await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", fakeFetch(200, fixture));
    expect(points).toHaveLength(2);
  });

  it("issues one request per 10-year window", async () => {
    let calls = 0;
    const countingFetch: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response(fixture, { status: 200 }));
    };

    await fetchSgsSeries("cdi", "2000-01-01", "2026-09-08", countingFetch);
    expect(calls).toBe(3);
  });

  it("throws SgsFetchError on a non-ok response", async () => {
    await expect(
      fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", fakeFetch(503, "")),
    ).rejects.toThrow(SgsFetchError);
  });
});
