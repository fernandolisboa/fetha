import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applyQuotationFactor, CotahistParseError, parseCotahist } from "./parser";

const fixture = readFileSync(path.join(import.meta.dirname, "fixtures", "cotahist-sample.txt"), {
  encoding: "latin1",
});

const registryFixture = readFileSync(
  path.join(import.meta.dirname, "..", "b3-instruments", "fixtures", "instruments-sample.csv"),
  { encoding: "latin1" },
);

describe("parseCotahist", () => {
  it("parses stock rows (TPMERC 010) with OHLC and traded quantity", () => {
    const rows = parseCotahist(fixture);
    const stocks = rows.filter((row) => row.kind === "stock");
    expect(stocks).toEqual([
      {
        kind: "stock",
        session: "2026-09-08",
        ticker: "PETR4",
        open: "48.100000",
        high: "48.500000",
        low: "47.530000",
        average: "48.060000",
        close: "48.090000",
        trades: 55621,
        tradedQuantity: 34388500,
      },
      {
        kind: "stock",
        session: "2026-09-08",
        ticker: "VALE3",
        open: "79.600000",
        high: "81.090000",
        low: "79.020000",
        average: "79.890000",
        close: "79.020000",
        trades: 38150,
        tradedQuantity: 17890200,
      },
      {
        kind: "stock",
        session: "2026-09-08",
        ticker: "FNAM11",
        open: "0.000440",
        high: "0.000440",
        low: "0.000400",
        average: "0.000410",
        close: "0.000410",
        trades: 244,
        tradedQuantity: 28225000,
      },
    ]);
  });

  it("parses option rows (TPMERC 070/080) with strike, expiry and right", () => {
    const rows = parseCotahist(fixture);
    const options = rows.filter((row) => row.kind === "option");
    expect(options).toEqual([
      {
        kind: "option",
        session: "2026-09-08",
        ticker: "PETRK312",
        right: "call",
        strike: "30.160000",
        expiry: "2026-11-19",
        factor: "1",
        open: "18.600000",
        high: "18.600000",
        low: "18.600000",
        average: "18.600000",
        close: "18.600000",
        trades: 1,
        tradedQuantity: 1700,
      },
      {
        kind: "option",
        session: "2026-09-08",
        ticker: "PETRW463",
        right: "put",
        strike: "45.160000",
        expiry: "2026-11-19",
        factor: "1",
        open: "1.970000",
        high: "1.970000",
        low: "1.970000",
        average: "1.970000",
        close: "1.970000",
        trades: 3,
        tradedQuantity: 3300,
      },
      {
        kind: "option",
        session: "2026-09-08",
        ticker: "IBOVA183",
        right: "call",
        strike: "183000.000000",
        expiry: "2027-01-13",
        factor: "100",
        open: "191.550000",
        high: "193.050000",
        low: "191.550000",
        average: "192.296000",
        close: "193.050000",
        trades: 2,
        tradedQuantity: 378,
      },
    ]);
  });

  it("skips header (00) and trailer (99) records", () => {
    const rows = parseCotahist(fixture);
    expect(rows).toHaveLength(6);
  });

  it("rejects a record that is not exactly 245 bytes", () => {
    expect(() => parseCotahist("01short")).toThrow(CotahistParseError);
  });

  it("rejects an unknown record type", () => {
    const badLine = `02${"0".repeat(243)}`;
    expect(() => parseCotahist(badLine)).toThrow(CotahistParseError);
  });

  it("returns an empty array for a file with only header and trailer", () => {
    const lines = fixture.split(/\r?\n/);
    const headerAndTrailer = [lines[0], lines[7]].join("\n");
    expect(parseCotahist(headerAndTrailer)).toEqual([]);
  });

  it("rejects a file whose DATA field differs from the requested session", () => {
    expect(() => parseCotahist(fixture, "2026-09-09")).toThrow(CotahistParseError);
  });

  it("accepts a file whose DATA field matches the requested session", () => {
    expect(() => parseCotahist(fixture, "2026-09-08")).not.toThrow();
  });

  describe("cross-source strike consistency against the real 2026-09-08 IBOVA183 excerpts", () => {
    it("PREEXE / 100 for IBOVA183 matches the instruments registry's ExrcPric (not / 100 x FATCOT)", () => {
      const rows = parseCotahist(fixture, "2026-09-08");
      const ibov = rows.find(
        (row): row is Extract<(typeof rows)[number], { kind: "option" }> =>
          row.kind === "option" && row.ticker === "IBOVA183",
      );
      expect(ibov?.strike).toBe("183000.000000");

      const registryLine = registryFixture
        .split(/\r?\n/)
        .find((line) => line.startsWith("2026-09-08;IBOVA183;"));
      const exrcPric = registryLine?.split(";")[35];
      expect(exrcPric).toBe("183000");
    });
  });
});

describe("applyQuotationFactor", () => {
  it("divides the raw integer by 100 x FATCOT at full precision, no premature rounding", () => {
    expect(applyQuotationFactor("44", "1000")).toBe("0.00044");
  });

  it("passes a factor of 1 through as an ordinary cents division", () => {
    expect(applyQuotationFactor("4810", "1")).toBe("48.1");
  });

  it("treats a blank factor as 1", () => {
    expect(applyQuotationFactor("4810", "")).toBe("48.1");
  });
});
