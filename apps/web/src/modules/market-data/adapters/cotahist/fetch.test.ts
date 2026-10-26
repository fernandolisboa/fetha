import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CotahistFetchError, cotahistDailyFileUrl, fetchCotahist } from "./fetch";

const zipFixture = readFileSync(path.join(import.meta.dirname, "fixtures", "cotahist-sample.zip"));
// The header, PETR4, the FROTA OCEÂNICA record B3 wrote with its name in UTF-8 (246 bytes) and
// the trailer, cut from the real COTAHIST_D22102026.ZIP.
const utf8RecordZip = readFileSync(
  path.join(import.meta.dirname, "fixtures", "cotahist-utf8-record.zip"),
);

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

  it("reads a record B3 wrote in UTF-8 inside the latin1 file at its fixed width", async () => {
    const rows = await fetchCotahist("2026-10-22", fakeFetch(200, utf8RecordZip));
    expect(rows.map((row) => row.ticker)).toEqual(["PETR4"]);
  });

  it("throws CotahistFetchError on a non-ok response", async () => {
    await expect(fetchCotahist("2026-09-08", fakeFetch(404, ""))).rejects.toThrow(
      CotahistFetchError,
    );
  });
});
