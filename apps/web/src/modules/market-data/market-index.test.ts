import { describe, expect, it } from "vitest";

import { ibovespa, isMarketIndex, marketIndexTickersForQuery } from "./market-index";

describe("isMarketIndex", () => {
  it("is true for IBOV11", () => {
    expect(isMarketIndex("IBOV11")).toBe(true);
  });

  it("is false for an ordinary ticker", () => {
    expect(isMarketIndex("PETR4")).toBe(false);
  });
});

describe("ibovespa", () => {
  it("is the registry's own join key, IBOV11, under B3's request code IBOV", () => {
    expect(ibovespa.ticker).toBe("IBOV11");
    expect(ibovespa.b3Code).toBe("IBOV");
    expect(ibovespa.shortLabel).toBe("IBOV");
  });
});

describe("marketIndexTickersForQuery", () => {
  it("finds IBOV11 by its alias 'ibovespa', which is not a ticker prefix", () => {
    expect(marketIndexTickersForQuery("ibovespa")).toEqual(["IBOV11"]);
  });

  it("finds IBOV11 by the shorter alias 'ibov' exactly once", () => {
    expect(marketIndexTickersForQuery("ibov")).toEqual(["IBOV11"]);
  });

  it("is case-insensitive", () => {
    expect(marketIndexTickersForQuery("IBOVESPA")).toEqual(["IBOV11"]);
  });

  it("is accent-insensitive: an accented variant of the same alias still matches", () => {
    expect(marketIndexTickersForQuery("íbovéspa")).toEqual(["IBOV11"]);
  });

  it("returns nothing for an unrelated query", () => {
    expect(marketIndexTickersForQuery("petr")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(marketIndexTickersForQuery("")).toEqual([]);
  });
});
