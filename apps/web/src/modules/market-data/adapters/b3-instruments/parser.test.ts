import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseInstrumentsRegistry } from "./parser";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"), {
  encoding: "latin1",
});

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
