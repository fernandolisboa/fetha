import { describe, expect, it } from "vitest";

import { isMarketIndex, marketIndexOf, marketIndexTickersForQuery } from "./market-index";

describe("isMarketIndex", () => {
  it("is true for IBOV11", () => {
    expect(isMarketIndex("IBOV11")).toBe(true);
  });

  it("is false for an ordinary ticker", () => {
    expect(isMarketIndex("PETR4")).toBe(false);
  });
});

describe("marketIndexOf", () => {
  it("resolves IBOV11 to its label", () => {
    expect(marketIndexOf("IBOV11")?.label).toBe("Ibovespa");
  });

  it("returns null for an ordinary ticker", () => {
    expect(marketIndexOf("PETR4")).toBeNull();
  });
});

describe("marketIndexTickersForQuery", () => {
  it("finds IBOV11 by its alias 'ibovespa', which is not a ticker prefix", () => {
    expect(marketIndexTickersForQuery("ibovespa")).toEqual(["IBOV11"]);
  });

  it("finds IBOV11 by the shorter alias 'ibov' exactly once", () => {
    expect(marketIndexTickersForQuery("ibov")).toEqual(["IBOV11"]);
  });

  it("is case- and accent-insensitive", () => {
    expect(marketIndexTickersForQuery("IBOVÉSPA".slice(0, 4))).toEqual(["IBOV11"]);
  });

  it("returns nothing for an unrelated query", () => {
    expect(marketIndexTickersForQuery("petr")).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(marketIndexTickersForQuery("")).toEqual([]);
  });
});
