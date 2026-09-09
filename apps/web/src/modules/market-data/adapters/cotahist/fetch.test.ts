import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CotahistFetchError, cotahistDailyFileUrl, fetchCotahist } from "./fetch";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "cotahist-sample.txt"),
  "utf-8",
);

function fakeFetch(status: number, body: string): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

describe("cotahistDailyFileUrl", () => {
  it("builds the B3 daily COTAHIST zip URL for a session", () => {
    expect(cotahistDailyFileUrl("2026-09-08")).toBe(
      "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D08092026.ZIP",
    );
  });
});

describe("fetchCotahist", () => {
  it("parses the response body through the fixed-width parser", async () => {
    const rows = await fetchCotahist("2026-09-08", fakeFetch(200, fixture));
    expect(rows).toHaveLength(2);
  });

  it("throws CotahistFetchError on a non-ok response", async () => {
    await expect(fetchCotahist("2026-09-08", fakeFetch(404, ""))).rejects.toThrow(
      CotahistFetchError,
    );
  });
});
