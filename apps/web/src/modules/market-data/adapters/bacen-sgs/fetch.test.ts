import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SgsFetchError, SgsNotPublishedError, fetchSgsSeries, sgsUrl } from "./fetch";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "sgs-cdi-sample.json"),
  "utf-8",
);

const sessions = [
  { date: "2026-01-01", open: "2026-01-01T13:00:00.000Z" },
  { date: "2026-09-09", open: "2026-09-09T13:00:00.000Z" },
];

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
    const points = await fetchSgsSeries(
      "cdi",
      "2026-01-01",
      "2026-09-08",
      sessions,
      fakeFetch(200, fixture),
    );
    expect(points).toHaveLength(5);
  });

  it("issues one request per 10-year window", async () => {
    let calls = 0;
    const countingFetch: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response(fixture, { status: 200 }));
    };

    await fetchSgsSeries("cdi", "2000-01-01", "2026-09-08", sessions, countingFetch);
    expect(calls).toBe(3);
  });

  it("throws SgsFetchError on a non-ok response", async () => {
    await expect(
      fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fakeFetch(503, "")),
    ).rejects.toThrow(SgsFetchError);
  });

  it("throws SgsNotPublishedError when SGS answers its 'Value(s) not found' 404", async () => {
    const body = JSON.stringify({
      erro: {
        statusCode: 404,
        detail: "br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found",
      },
    });

    await expect(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, fakeFetch(404, body)),
    ).rejects.toThrow(SgsNotPublishedError);
  });

  it("keeps any other 404 a plain fetch failure, not a not-yet-published one", async () => {
    const rejection = fetchSgsSeries(
      "cdi",
      "2026-09-26",
      "2026-09-28",
      sessions,
      fakeFetch(404, "<html>Not Found</html>"),
    );

    await expect(rejection).rejects.toThrow(SgsFetchError);
    await expect(rejection).rejects.not.toThrow(SgsNotPublishedError);
  });
});
