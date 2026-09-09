import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseInstrumentsRegistry } from "./parser";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"),
  "utf-8",
);

describe("parseInstrumentsRegistry", () => {
  it("parses call and put option series with underlying, strike, expiry and style", () => {
    const series = parseInstrumentsRegistry(fixture);
    expect(series).toEqual([
      {
        ticker: "PETRW123",
        underlying: "PETR",
        right: "call",
        strike: "27.00",
        expiry: "2026-10-16",
        style: "american",
        asOf: "2026-09-08",
      },
      {
        ticker: "PETRW456",
        underlying: "PETR",
        right: "put",
        strike: "24.50",
        expiry: "2026-11-20",
        style: "european",
        asOf: "2026-09-08",
      },
    ]);
  });

  it("skips non-option rows (e.g. stocks, CFICode ES...)", () => {
    const series = parseInstrumentsRegistry(fixture);
    expect(series.every((row) => row.ticker !== "PETR4")).toBe(true);
  });

  it("returns an empty array for a header-only file", () => {
    const [header] = fixture.split("\n");
    expect(parseInstrumentsRegistry(header ?? "")).toEqual([]);
  });

  it("throws if a required column is missing", () => {
    expect(() => parseInstrumentsRegistry("TckrSymb;Asst\nPETR4;PETR")).toThrow(/RptDt/);
  });
});
