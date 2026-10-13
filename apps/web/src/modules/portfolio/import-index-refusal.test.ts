import {
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
} from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import type { ImportedFill } from "./b3-import/parse-negotiation";
import { removeIndexStockLegs } from "./import-index-refusal";

function stockFill(ticker: string): ImportedFill {
  return {
    ticker: tickerSchema.parse(ticker),
    assetClass: "stock",
    side: "buy",
    quantity: quantitySchema.parse(100),
    price: "30.500000" as DecimalString,
    session: sessionDateSchema.parse("2026-09-15"),
    importKey: `k-${ticker}`,
  };
}

function optionFill(ticker: string): ImportedFill {
  return { ...stockFill(ticker), assetClass: "option" };
}

describe("removeIndexStockLegs", () => {
  it("drops a stock fill on a market index and counts it, keeping ordinary rows", () => {
    const fills = [stockFill("PETR4"), stockFill("IBOV11"), optionFill("PETRJ320")];
    const result = removeIndexStockLegs(fills);
    expect(result.importable.map((fill) => fill.ticker)).toEqual(["PETR4", "PETRJ320"]);
    expect(result.indexStockLegSkipped).toBe(1);
  });

  it("never drops an option fill whose own ticker happens to be a market index's underlying", () => {
    // `IBOV11` itself is never an option ticker, but the refusal is keyed on `assetClass`
    // (ADR-0062: only a *stock* leg on an index has no real-world fill to represent), not on
    // `isMarketIndex` alone.
    const fills = [optionFill("IBOV11")];
    const result = removeIndexStockLegs(fills);
    expect(result.importable).toHaveLength(1);
    expect(result.indexStockLegSkipped).toBe(0);
  });

  it("counts nothing when no row names a market index", () => {
    const fills = [stockFill("PETR4"), stockFill("VALE3")];
    const result = removeIndexStockLegs(fills);
    expect(result.importable).toHaveLength(2);
    expect(result.indexStockLegSkipped).toBe(0);
  });
});
