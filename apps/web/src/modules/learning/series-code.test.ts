import { describe, expect, it } from "vitest";

import {
  ILLUSTRATIVE_HIGHER_STRIKE,
  ILLUSTRATIVE_LOWER_STRIKE,
  loadIllustrativeExamples,
} from "./illustrative-market";
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
});

describe("the illustrative market's own tickers", () => {
  it("decode to the same right and month as the option series they price", async () => {
    const examples = await loadIllustrativeExamples();
    for (const exampleId of ["long-call", "long-put", "short-call"] as const) {
      const pricing = examples[exampleId];
      expect(pricing.legs).toHaveLength(1);
      const leg = pricing.legs[0];
      if (!leg) throw new Error("fixture example has no leg");
      const letter = seriesLetterOf(leg.leg.ticker);
      const decoded = decodeSeriesLetter(letter);
      const expectedRight = leg.leg.role === "call" ? "call" : "put";
      expect(decoded.right).toBe(expectedRight);
      // The illustrative expiry is 2026-02-20: February.
      expect(decoded.month).toBe(2);
    }
  });

  it("never uses a trailing ticker number equal to the series' own strike", async () => {
    const examples = await loadIllustrativeExamples();
    const lowerStrikeDigits = String(Number(ILLUSTRATIVE_LOWER_STRIKE));
    const higherStrikeDigits = String(Number(ILLUSTRATIVE_HIGHER_STRIKE));

    const callLowerTicker = examples["long-call"].legs[0]?.leg.ticker ?? "";
    const putLowerTicker = examples["long-put"].legs[0]?.leg.ticker ?? "";
    expect(callLowerTicker.slice(5)).not.toBe(lowerStrikeDigits);
    expect(putLowerTicker.slice(5)).not.toBe(lowerStrikeDigits);
    expect(higherStrikeDigits).toBe("22");
  });
});
