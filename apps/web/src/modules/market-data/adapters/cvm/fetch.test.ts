import { readFileSync } from "node:fs";
import path from "node:path";

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { CvmFetchError, fcaFileUrl, fetchFcaTickers, fetchIpeFilings, ipeFileUrl } from "./fetch";

function readFixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(import.meta.dirname, "fixtures", name)));
}

function zipResponse(entries: Record<string, Uint8Array>): Response {
  return new Response(zipSync(entries), { status: 200 });
}

function fetchReturning(response: () => Response): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = ((input: string) => {
    urls.push(input);
    return Promise.resolve(response());
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("CVM open-data urls", () => {
  it("point at the yearly IPE and FCA zips", () => {
    expect(ipeFileUrl(2026)).toBe(
      "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_2026.zip",
    );
    expect(fcaFileUrl(2026)).toBe(
      "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_2026.zip",
    );
  });
});

describe("fetchIpeFilings", () => {
  it("reads the year's CSV out of the zip as latin1", async () => {
    const { fetchImpl, urls } = fetchReturning(() =>
      zipResponse({ "ipe_cia_aberta_2026.csv": readFixtureBytes("ipe-sample.csv") }),
    );

    const parsed = await fetchIpeFilings(2026, fetchImpl);

    expect(urls).toEqual([ipeFileUrl(2026)]);
    expect(parsed?.filings).toHaveLength(9);
    expect(parsed?.filings[0]?.companyName).toBe("PETRÓLEO BRASILEIRO S.A. - PETROBRAS");
  });

  it("returns null while CVM has not generated the year's file", async () => {
    const { fetchImpl } = fetchReturning(() => new Response("not found", { status: 404 }));

    await expect(fetchIpeFilings(2027, fetchImpl)).resolves.toBeNull();
  });

  it("fails on any other non-2xx answer", async () => {
    const { fetchImpl } = fetchReturning(() => new Response("down", { status: 503 }));

    await expect(fetchIpeFilings(2026, fetchImpl)).rejects.toBeInstanceOf(CvmFetchError);
  });

  it("fails when the zip lacks the year's CSV", async () => {
    const { fetchImpl } = fetchReturning(() =>
      zipResponse({ "ipe_cia_aberta_2025.csv": readFixtureBytes("ipe-sample.csv") }),
    );

    await expect(fetchIpeFilings(2026, fetchImpl)).rejects.toBeInstanceOf(CvmFetchError);
  });
});

describe("fetchFcaTickers", () => {
  it("reads only the securities table out of the FCA zip", async () => {
    const { fetchImpl, urls } = fetchReturning(() =>
      zipResponse({
        "fca_cia_aberta_2026.csv": new TextEncoder().encode("unrelated"),
        "fca_cia_aberta_valor_mobiliario_2026.csv": readFixtureBytes(
          "fca-valor-mobiliario-sample.csv",
        ),
      }),
    );

    const parsed = await fetchFcaTickers(2026, fetchImpl);

    expect(urls).toEqual([fcaFileUrl(2026)]);
    expect(parsed?.tickers.map((ticker) => ticker.ticker)).toEqual([
      "PETR3",
      "PETR4",
      "VALE3",
      "TGMA3",
    ]);
  });
});
