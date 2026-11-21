import { describe, expect, it } from "vitest";

import { ILLUSTRATIVE_OPTION_SERIES } from "./illustrative-market";
import { decodeSeriesLetter, seriesLetterOf } from "./series-code";

describe("decodeSeriesLetter", () => {
  it("decodes A through L as a call, January through December in order", () => {
    expect(decodeSeriesLetter("A")).toEqual({ right: "call", month: 1 });
    expect(decodeSeriesLetter("B")).toEqual({ right: "call", month: 2 });
    expect(decodeSeriesLetter("L")).toEqual({ right: "call", month: 12 });
  });

  it("decodes M through X as a put, January through December in order", () => {
    expect(decodeSeriesLetter("M")).toEqual({ right: "put", month: 1 });
    expect(decodeSeriesLetter("N")).toEqual({ right: "put", month: 2 });
    expect(decodeSeriesLetter("X")).toEqual({ right: "put", month: 12 });
  });

  it("throws on a letter outside A-X", () => {
    expect(() => decodeSeriesLetter("Y")).toThrow();
    expect(() => decodeSeriesLetter("Z")).toThrow();
  });

  it("throws on anything that is not a single letter", () => {
    expect(() => decodeSeriesLetter("")).toThrow();
    expect(() => decodeSeriesLetter("AB")).toThrow();
    expect(() => decodeSeriesLetter("A1")).toThrow();
  });
});

describe("every illustrative option series' own ticker", () => {
  it("decodes to that series' own right and expiry month", () => {
    expect(ILLUSTRATIVE_OPTION_SERIES.length).toBeGreaterThan(0);
    for (const series of ILLUSTRATIVE_OPTION_SERIES) {
      const letter = seriesLetterOf(series.ticker);
      const decoded = decodeSeriesLetter(letter);
      expect(decoded.right).toBe(series.right);
      // The illustrative expiry is 2026-02-20 for every series: February.
      expect(decoded.month).toBe(Number(series.expiry.slice(5, 7)));
    }
  });

  it("never uses a trailing ticker number equal to that series' own strike", () => {
    for (const series of ILLUSTRATIVE_OPTION_SERIES) {
      const trailingNumber = series.ticker.slice(5);
      const strikeDigits = String(Number(series.strike));
      expect(trailingNumber).not.toBe(strikeDigits);
    }
  });
});
