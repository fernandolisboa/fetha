import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseIndexYear } from "./parser";

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf-8"));
}

describe("parseIndexYear", () => {
  it("parses every published day across the 12 month columns, Brazilian format to six decimals", () => {
    const points = parseIndexYear(2026, readFixture("ibov-2026-sample.json"));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.date).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(point.close).toMatch(/^\d+\.\d{6}$/);
    }
  });

  it("converts a Brazilian-formatted value exactly", () => {
    const points = parseIndexYear(2026, readFixture("ibov-2026-sample.json"));
    const oct9 = points.find((point) => point.date === "2026-10-09");
    expect(oct9).toEqual({ date: "2026-10-09", close: "209066.900000" });
  });

  it("skips null days", () => {
    const points = parseIndexYear(2026, readFixture("ibov-2026-sample.json"));
    expect(points.some((point) => point.date === "2026-10-10")).toBe(false);
    expect(points.some((point) => point.date === "2026-11-01")).toBe(false);
  });

  it("covers every month with at least one published day across the full year sample", () => {
    const points = parseIndexYear(2024, readFixture("ibov-2024-sample.json"));
    const months = new Set(points.map((point) => point.date.slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(9);
  });

  it("returns an empty array for results: null", () => {
    expect(parseIndexYear(2099, { min: null, max: null, results: null })).toEqual([]);
  });

  it("returns an empty array for a year whose results are all null", () => {
    const allNullRow = {
      day: 1,
      rateValue1: null,
      rateValue2: null,
      rateValue3: null,
      rateValue4: null,
      rateValue5: null,
      rateValue6: null,
      rateValue7: null,
      rateValue8: null,
      rateValue9: null,
      rateValue10: null,
      rateValue11: null,
      rateValue12: null,
    };
    expect(parseIndexYear(2099, { results: [allNullRow] })).toEqual([]);
  });

  it("throws without provider text when a value lands on an impossible date", () => {
    const impossibleRow = {
      day: 31,
      rateValue1: null,
      rateValue2: "120.000,00",
      rateValue3: null,
      rateValue4: null,
      rateValue5: null,
      rateValue6: null,
      rateValue7: null,
      rateValue8: null,
      rateValue9: null,
      rateValue10: null,
      rateValue11: null,
      rateValue12: null,
    };
    expect(() => parseIndexYear(2026, { results: [impossibleRow] })).toThrow(
      "B3 index statistics returned a value for an impossible date",
    );
  });

  it("rejects a malformed payload", () => {
    expect(() => parseIndexYear(2026, { results: "not-an-array" })).toThrow();
  });

  it("converts the ticket's own example exactly (#307)", () => {
    const row = {
      day: 1,
      rateValue1: "184.691,05",
      rateValue2: null,
      rateValue3: null,
      rateValue4: null,
      rateValue5: null,
      rateValue6: null,
      rateValue7: null,
      rateValue8: null,
      rateValue9: null,
      rateValue10: null,
      rateValue11: null,
      rateValue12: null,
    };
    const points = parseIndexYear(2026, { results: [row] });
    expect(points).toEqual([{ date: "2026-01-01", close: "184691.050000" }]);
  });

  describe("a non-numeric or malformed day value (#289, #307 round 2)", () => {
    function rowWith(value: string) {
      return {
        day: 1,
        rateValue1: value,
        rateValue2: null,
        rateValue3: null,
        rateValue4: null,
        rateValue5: null,
        rateValue6: null,
        rateValue7: null,
        rateValue8: null,
        rateValue9: null,
        rateValue10: null,
        rateValue11: null,
        rateValue12: null,
      };
    }

    it.each(["N/D", "NaN", "Infinity", "-1.234,56", "209066.90"])(
      "rejects %s without reading it as a valid value",
      (value) => {
        expect(() => parseIndexYear(2026, { results: [rowWith(value)] })).toThrow();
      },
    );

    it("never quotes the provider text in the thrown message", () => {
      expect(() => parseIndexYear(2026, { results: [rowWith("NaN")] })).toThrow(
        "B3 index statistics returned a non-numeric value for 2026-01-01",
      );
      try {
        parseIndexYear(2026, { results: [rowWith("NaN")] });
      } catch (error) {
        expect(String(error)).not.toContain("NaN");
      }
    });
  });
});
