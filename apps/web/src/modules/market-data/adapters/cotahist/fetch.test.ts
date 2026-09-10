import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CotahistFetchError, cotahistDailyFileUrl, fetchCotahist } from "./fetch";

const zipFixture = readFileSync(path.join(import.meta.dirname, "fixtures", "cotahist-sample.zip"));

function fakeFetch(status: number, body: Uint8Array | string): typeof fetch {
  return () => Promise.resolve(new Response(body as BodyInit, { status }));
}

describe("cotahistDailyFileUrl", () => {
  it("builds the B3 daily COTAHIST zip URL for a session", () => {
    expect(cotahistDailyFileUrl("2026-09-08")).toBe(
      "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D08092026.ZIP",
    );
  });
});

describe("fetchCotahist", () => {
  it("decompresses the real B3 zip, decodes latin1 and parses the fixed-width rows", async () => {
    const rows = await fetchCotahist("2026-09-08", fakeFetch(200, zipFixture));
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.kind === "stock").map((row) => row.ticker)).toEqual([
      "PETR4",
      "VALE3",
      "FNAM11",
    ]);
    expect(rows.filter((row) => row.kind === "option").map((row) => row.ticker)).toEqual([
      "PETRK312",
      "PETRW463",
    ]);
  });

  it("throws CotahistFetchError on a non-ok response", async () => {
    await expect(fetchCotahist("2026-09-08", fakeFetch(404, ""))).rejects.toThrow(
      CotahistFetchError,
    );
  });
});
