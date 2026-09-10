import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseInstrumentsRegistry } from "./parser";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "instruments-sample.csv"), {
  encoding: "latin1",
});

describe("parseInstrumentsRegistry", () => {
  it("parses call and put option series with underlying, strike, expiry, style and isin", () => {
    const { series } = parseInstrumentsRegistry(fixture);
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
    const { series } = parseInstrumentsRegistry(fixture);
    const withComma = series.find((row) => row.ticker === "VALEA108");
    expect(withComma?.strike).toBe("106.24");
  });

  it("skips non-option rows (stocks) and the leading status line", () => {
    const { series } = parseInstrumentsRegistry(fixture);
    expect(series.every((row) => row.ticker !== "PETR4")).toBe(true);
    expect(series).toHaveLength(13);
  });

  it("skips a commodity option row out of scope (blank category, OPTIONS ON FUTURE) without throwing", () => {
    const { series } = parseInstrumentsRegistry(fixture);
    expect(series.some((row) => row.ticker === "BGIF27C034000")).toBe(false);
  });

  it("keeps the real IBOVA183 index option row", () => {
    const { series } = parseInstrumentsRegistry(fixture);
    const ibov = series.find((row) => row.ticker === "IBOVA183");
    expect(ibov).toMatchObject({
      underlying: "IBOV11",
      right: "call",
      strike: "183000",
      style: "european",
    });
  });

  it("returns an empty series array and zero skipped for a status + header only file", () => {
    const [status, header] = fixture.split("\n");
    expect(parseInstrumentsRegistry(`${status ?? ""}\n${header ?? ""}`)).toEqual({
      series: [],
      skipped: 0,
    });
  });

  it("throws if a required column is missing", () => {
    expect(() =>
      parseInstrumentsRegistry("Status do Arquivo: Final\nTckrSymb;Asst\nPETR4;PETR"),
    ).toThrow(/RptDt/);
  });

  it("counts non-conforming in-scope rows as skipped instead of only logging them", () => {
    const header = "RptDt;TckrSymb;Asst;ISIN;XprtnDt;OptnStyle;ExrcPric;OptnTp;SctyCtgyNm";
    const missingIsin = "2026-09-08;ZZZW1;ZZZ3;;2026-10-16;AMER;5,00;Call;OPTION ON EQUITIES";
    const content = ["Status do Arquivo: Final", header, missingIsin].join("\n");

    const { series, skipped } = parseInstrumentsRegistry(content);
    expect(series).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("throws instead of silently returning a registry with more skips than the threshold allows", () => {
    const header = "RptDt;TckrSymb;Asst;ISIN;XprtnDt;OptnStyle;ExrcPric;OptnTp;SctyCtgyNm";
    const missingIsin = "2026-09-08;ZZZW1;ZZZ3;;2026-10-16;AMER;5,00;Call;OPTION ON EQUITIES";
    const rows = Array.from({ length: 11 }, () => missingIsin);
    const content = ["Status do Arquivo: Final", header, ...rows].join("\n");

    expect(() => parseInstrumentsRegistry(content)).toThrow(/skipped/i);
  });
});
