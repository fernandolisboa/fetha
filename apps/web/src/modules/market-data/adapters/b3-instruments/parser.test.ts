import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseInstrumentsRegistry } from "./parser";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"), {
  encoding: "latin1",
});

const REAL_REGISTRY_PATH =
  "/tmp/claude-1000/-home-ferna-projects-financas-fetha/53edd023-9f9b-4060-9e9b-f0c9dc969b3a/scratchpad/r12/real/instruments-2026-09-08.csv";

describe("parseInstrumentsRegistry", () => {
  it("parses call and put option series with underlying, strike, expiry, style and isin", () => {
    const series = parseInstrumentsRegistry(fixture);
    expect(series[0]).toEqual({
      ticker: "PETRA1",
      isin: "BRPETR4A1TF9",
      underlying: "PETR4",
      right: "call",
      strike: "43.94",
      expiry: "2028-01-21",
      style: "american",
      asOf: "2026-09-08",
    });
    expect(series[1]).toEqual({
      ticker: "PETRM1",
      isin: "BRPETR4M1T58",
      underlying: "PETR4",
      right: "put",
      strike: "43.94",
      expiry: "2028-01-21",
      style: "european",
      asOf: "2026-09-08",
    });
  });

  it("converts the comma decimal separator in ExrcPric to a dot", () => {
    const series = parseInstrumentsRegistry(fixture);
    const withComma = series.find((row) => row.ticker === "VALEA108");
    expect(withComma?.strike).toBe("106.24");
  });

  it("skips non-option rows (stocks) and the leading status line", () => {
    const series = parseInstrumentsRegistry(fixture);
    expect(series.every((row) => row.ticker !== "PETR4")).toBe(true);
    expect(series).toHaveLength(12);
  });

  it("skips a commodity option row out of scope (blank category, OPTIONS ON FUTURE) without throwing", () => {
    const series = parseInstrumentsRegistry(fixture);
    expect(series.some((row) => row.ticker === "BGIF27C034000")).toBe(false);
  });

  (existsSync(REAL_REGISTRY_PATH) ? describe : describe.skip)(
    "against the real 2026-09-08 registry",
    () => {
      const realFixture = existsSync(REAL_REGISTRY_PATH)
        ? readFileSync(REAL_REGISTRY_PATH, { encoding: "latin1" })
        : "";

      it("parses the whole file without throwing, dropping out-of-scope commodity/FX option rows", () => {
        const series = parseInstrumentsRegistry(realFixture);
        expect(series.length).toBeGreaterThan(0);
        expect(series.every((row) => row.ticker !== "BGIF27C034000")).toBe(true);
      });

      it("keeps the real IBOVA183 index option row", () => {
        const series = parseInstrumentsRegistry(realFixture);
        const ibov = series.find((row) => row.ticker === "IBOVA183");
        expect(ibov).toMatchObject({
          underlying: "IBOV11",
          right: "call",
          strike: "183000",
          style: "european",
        });
      });
    },
  );

  it("returns an empty array for a status + header only file", () => {
    const [status, header] = fixture.split("\n");
    expect(parseInstrumentsRegistry(`${status ?? ""}\n${header ?? ""}`)).toEqual([]);
  });

  it("throws if a required column is missing", () => {
    expect(() =>
      parseInstrumentsRegistry("Status do Arquivo: Final\nTckrSymb;Asst\nPETR4;PETR"),
    ).toThrow(/RptDt/);
  });
});
