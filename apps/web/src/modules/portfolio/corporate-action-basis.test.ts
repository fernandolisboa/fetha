import { describe, expect, it } from "vitest";
import type { DecimalString, SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor } from "@fetha/engine";

import type { LedgerFill } from "./bookkeeping";
import {
  normalizeFillsForHoldingsBasis,
  normalizeFillsForOperationBasis,
  splitFactorProduct,
} from "./corporate-action-basis";

let seq = 0;
function fill(overrides: Partial<LedgerFill>): LedgerFill {
  seq += 1;
  return {
    ticker: "PETR4",
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: "10" as DecimalString,
    session: "2026-09-01",
    seq,
    expiry: null,
    costsCentavos: 0,
    ...overrides,
  };
}

function split(exDate: string, factor: string): CorporateActionFactor {
  return {
    ticker: "PETR4",
    exDate: exDate,
    asOf: `${exDate}T13:00:00.000Z` as never,
    factor: factor as DecimalString,
  };
}

describe("splitFactorProduct", () => {
  it("is 1 with no factors in the window", () => {
    const result = splitFactorProduct([], "2026-09-01", "2026-09-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toString()).toBe("1");
  });

  it("excludes a factor ex-dated at or before openedAt", () => {
    const result = splitFactorProduct([split("2026-09-01", "0.5")], "2026-09-01", "2026-09-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toString()).toBe("1");
  });

  it("includes a factor ex-dated after openedAt and at or before through", () => {
    const result = splitFactorProduct([split("2026-09-05", "0.5")], "2026-09-01", "2026-09-10");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toString()).toBe("0.5");
  });

  it("rejects a non-positive factor", () => {
    const result = splitFactorProduct([split("2026-09-05", "0")], "2026-09-01", "2026-09-10");
    expect(result.ok).toBe(false);
  });
});

describe("normalizeFillsForOperationBasis (#271)", () => {
  it("leaves every fill unchanged with no corporate actions", () => {
    const fills = [fill({ session: "2026-09-01" })];
    const result = normalizeFillsForOperationBasis(fills, "2026-09-01", []);
    expect(result).toEqual({ fills, skipped: false });
  });

  it("leaves a pre-split fill unchanged: the engine's own forward rebase handles it", () => {
    const fills = [fill({ session: "2026-09-01", quantity: 100, price: "10" as DecimalString })];
    const factors = [split("2026-09-10", "0.5")];
    const result = normalizeFillsForOperationBasis(fills, "2026-09-01", factors);
    expect(result).toEqual({ fills, skipped: false });
  });

  it("converts a post-split fill back to the operation's openedAt basis", () => {
    const openedAt = "2026-09-01" as SessionDate;
    const postSplitFill = fill({
      session: "2026-09-15",
      quantity: 200,
      price: "5" as DecimalString,
    });
    const factors = [split("2026-09-10", "0.5")];
    const result = normalizeFillsForOperationBasis([postSplitFill], openedAt, factors);
    expect(result.skipped).toBe(false);
    expect(result.fills).toEqual([{ ...postSplitFill, quantity: 100, price: "10.00000000" }]);
  });

  it("combines a pre-split buy and a post-split buy onto one basis, netting correctly after the engine's own forward rebase", () => {
    const openedAt = "2026-09-01" as SessionDate;
    const preSplitFill = fill({
      session: "2026-09-01",
      quantity: 100,
      price: "10" as DecimalString,
    });
    const postSplitFill = fill({
      session: "2026-09-15",
      quantity: 100,
      price: "6" as DecimalString,
    });
    const factors = [split("2026-09-10", "0.5")];
    const result = normalizeFillsForOperationBasis(
      [preSplitFill, postSplitFill],
      openedAt,
      factors,
    );
    expect(result.skipped).toBe(false);
    // The post-split fill nets to 50 nominal shares at R$12.00; summed with the pre-split 100
    // shares at R$10.00 this is a nominal 150 shares, which the engine's own forward rebase
    // (÷0.5) turns into the real current 300 shares the broker shows.
    expect(result.fills).toEqual([
      preSplitFill,
      { ...postSplitFill, quantity: 50, price: "12.00000000" },
    ]);
  });

  it("does not double-rebase a hand-entered post-split position (its own date is the basis)", () => {
    const openedAt = "2026-09-15" as SessionDate;
    const handEntered = fill({
      session: "2026-09-15",
      quantity: 200,
      price: "5" as DecimalString,
    });
    const factors = [split("2026-09-10", "0.5")];
    const result = normalizeFillsForOperationBasis([handEntered], openedAt, factors);
    expect(result).toEqual({ fills: [handEntered], skipped: false });
  });

  it("refuses to silently round a non-integer rebase and returns every fill unchanged", () => {
    const openedAt = "2026-09-01" as SessionDate;
    const fills = [
      fill({ session: "2026-09-01", quantity: 100 }),
      fill({ session: "2026-09-15", quantity: 101 }),
    ];
    // A 3-for-2 bonus: factor 2/3 does not evenly divide 101.
    const factors = [split("2026-09-10", "0.6666666667")];
    const result = normalizeFillsForOperationBasis(fills, openedAt, factors);
    expect(result).toEqual({ fills, skipped: true });
  });
});

describe("normalizeFillsForHoldingsBasis (#271)", () => {
  it("normalizes each (ticker, expiry) holding against its own earliest fill's session", () => {
    const preSplit = fill({
      ticker: "PETR4",
      session: "2026-09-01",
      quantity: 50,
      price: "20" as DecimalString,
    });
    const postSplit = fill({
      ticker: "PETR4",
      session: "2026-09-15",
      quantity: 100,
      price: "10" as DecimalString,
    });
    const factors = new Map([["PETR4", [split("2026-09-10", "0.5")]]]);
    const result = normalizeFillsForHoldingsBasis([preSplit, postSplit], () => "PETR4", factors);
    expect(result).toEqual([preSplit, { ...postSplit, quantity: 50, price: "20.00000000" }]);
  });

  it("does not rebase a holding whose underlying is unresolved", () => {
    const unresolved = fill({ ticker: "PETRJ320", session: "2026-09-01" });
    const result = normalizeFillsForHoldingsBasis([unresolved], () => null, new Map());
    expect(result).toEqual([unresolved]);
  });
});
