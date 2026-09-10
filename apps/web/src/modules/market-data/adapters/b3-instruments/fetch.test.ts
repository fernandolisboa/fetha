import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  InstrumentsFetchError,
  downloadUrl,
  fetchInstrumentsRegistry,
  requestNameUrl,
} from "./fetch";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"), {
  encoding: "latin1",
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function twoStepFetch(status: number, body: string): typeof fetch {
  return (input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes("requestname")) {
      return Promise.resolve(new Response(JSON.stringify({ token: "the-token" }), { status: 200 }));
    }
    return Promise.resolve(new Response(body, { status }));
  };
}

describe("requestNameUrl / downloadUrl", () => {
  it("builds the token-request URL for the InstrumentsConsolidated file", () => {
    expect(requestNameUrl("2026-09-08")).toBe(
      "https://arquivos.b3.com.br/api/download/requestname?fileName=InstrumentsConsolidatedFile&date=2026-09-08&recaptchaToken=",
    );
  });

  it("builds the download URL for a token", () => {
    expect(downloadUrl("the-token")).toBe(
      "https://arquivos.b3.com.br/api/download/?token=the-token",
    );
  });
});

describe("fetchInstrumentsRegistry", () => {
  it("requests a token then downloads and parses the CSV", async () => {
    const result = await fetchInstrumentsRegistry("2026-09-08", twoStepFetch(200, fixture));
    expect(result.series).toHaveLength(13);
    expect(result.skipped).toBe(0);
  });

  it("throws InstrumentsFetchError when the token request fails", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response("", { status: 500 }));
    await expect(fetchInstrumentsRegistry("2026-09-08", fetchImpl)).rejects.toThrow(
      InstrumentsFetchError,
    );
  });

  it("throws InstrumentsFetchError when the download fails", async () => {
    await expect(fetchInstrumentsRegistry("2026-09-08", twoStepFetch(500, ""))).rejects.toThrow(
      InstrumentsFetchError,
    );
  });
});
