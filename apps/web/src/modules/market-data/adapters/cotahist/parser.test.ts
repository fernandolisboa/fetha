import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CotahistParseError, parseCotahist } from "./parser";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "cotahist-sample.txt"),
  "utf-8",
);

describe("parseCotahist", () => {
  it("parses a stock row (TPMERC 010) with OHLC and traded quantity", () => {
    const rows = parseCotahist(fixture);
    const stock = rows.find((row) => row.kind === "stock");
    expect(stock).toEqual({
      kind: "stock",
      session: "2026-09-08",
      ticker: "PETR4",
      open: "25.50",
      high: "26.10",
      low: "25.00",
      average: "25.55",
      close: "26.00",
      trades: 12345,
      tradedQuantity: 9876543,
    });
  });

  it("parses an option row (TPMERC 070) with strike, expiry and FATCOT", () => {
    const rows = parseCotahist(fixture);
    const option = rows.find((row) => row.kind === "option");
    expect(option).toEqual({
      kind: "option",
      session: "2026-09-08",
      ticker: "PETRW123",
      right: "call",
      strike: "27.00",
      expiry: "2026-10-16",
      factor: "1",
      open: "1.50",
      high: "1.80",
      low: "1.40",
      average: "1.60",
      close: "1.70",
      trades: 320,
      tradedQuantity: 45000,
    });
  });

  it("skips header (00) and trailer (99) records", () => {
    const rows = parseCotahist(fixture);
    expect(rows).toHaveLength(2);
  });

  it("applies FATCOT as a divisor when different from 1", () => {
    const withFactor = fixture
      .split("\n")
      .map((line) =>
        line.startsWith("012026090878") ? `${line.slice(0, 210)}0001000${line.slice(217)}` : line,
      )
      .join("\n");
    const rows = parseCotahist(withFactor);
    const option = rows.find((row) => row.kind === "option");
    expect(option?.factor).toBe("1000");
    expect(option?.close).toBe("0.00");
  });

  it("rejects a record shorter than 245 bytes", () => {
    expect(() => parseCotahist("01short")).toThrow(CotahistParseError);
  });

  it("rejects an unknown record type", () => {
    const badLine = `02${"0".repeat(243)}`;
    expect(() => parseCotahist(badLine)).toThrow(CotahistParseError);
  });

  it("returns an empty array for a file with only header and trailer", () => {
    const lines = fixture.split("\n");
    const headerAndTrailer = [lines[0], lines[3]].join("\n");
    expect(parseCotahist(headerAndTrailer)).toEqual([]);
  });
});
