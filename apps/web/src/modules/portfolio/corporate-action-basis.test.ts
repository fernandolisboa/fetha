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

function holdingKeyOf(fill: LedgerFill): string {
  return `${fill.ticker}|${fill.expiry ?? ""}`;
}

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

  it("refuses the whole group, not just the offending fill, on a non-positive factor (review round 1 item 7)", () => {
    const openedAt = "2026-09-01" as SessionDate;
    const fills = [
      fill({ session: "2026-09-01", quantity: 100 }),
      fill({ session: "2026-09-15", quantity: 100 }),
    ];
    const factors = [split("2026-09-10", "0")];
    const result = normalizeFillsForOperationBasis(fills, openedAt, factors);
    expect(result).toEqual({ fills, skipped: true });
  });

  it("refuses a rebase that lands outside Quantity's bounds (review round 1 item 7)", () => {
    const openedAt = "2026-09-01" as SessionDate;
    const fills = [fill({ session: "2026-09-15", quantity: 2 })];
    // 2 ÷ 0.000001 = 2,000,000, past MAX_QUANTITY (1,000,000).
    const factors = [split("2026-09-10", "0.000001")];
    const result = normalizeFillsForOperationBasis(fills, openedAt, factors);
    expect(result).toEqual({ fills, skipped: true });
  });
});

describe("normalizeFillsForHoldingsBasis (#271, forward to asOf per review round 1 item 3)", () => {
  it("normalizes a pre-split and a post-split fill forward to today's basis, not back to the earliest session", () => {
    // 100 @ 30 pre-split, 100 @ 15 post-split (2-for-1, factor 0.5): the broker shows 300 shares
    // at an average of 15 today, never 150 @ 30 (de-rebasing to a pre-split basis fabricates a
    // loss since markToMarket never forward-rebases a bare Position of its own).
    const preSplit = fill({
      ticker: "PETR4",
      session: "2026-09-01",
      quantity: 100,
      price: "30" as DecimalString,
    });
    const postSplit = fill({
      ticker: "PETR4",
      session: "2026-09-15",
      quantity: 100,
      price: "15" as DecimalString,
    });
    const asOf = "2026-10-01" as SessionDate;
    const factors = new Map([["PETR4", [split("2026-09-10", "0.5")]]]);
    const result = normalizeFillsForHoldingsBasis(
      [preSplit, postSplit],
      asOf,
      () => "PETR4",
      factors,
    );
    expect(result.skippedHoldingKeys.size).toBe(0);
    expect(result.fills).toEqual([{ ...preSplit, quantity: 200, price: "15.00000000" }, postSplit]);
  });

  it("does not rebase a holding whose underlying is unresolved", () => {
    const unresolved = fill({ ticker: "PETRJ320", session: "2026-09-01" });
    const result = normalizeFillsForHoldingsBasis(
      [unresolved],
      "2026-10-01",
      () => null,
      new Map(),
    );
    expect(result).toEqual({ fills: [unresolved], skippedHoldingKeys: new Set() });
  });

  it("surfaces the holding's own key when its forward rebase is refused", () => {
    const first = fill({ ticker: "PETR4", session: "2026-09-01", quantity: 2 });
    const fills = [first, fill({ ticker: "PETR4", session: "2026-09-15", quantity: 101 })];
    // A 3-for-2 bonus: factor 2/3 does not evenly divide 101 shares forward.
    const factors = new Map([["PETR4", [split("2026-09-10", "1.5")]]]);
    const result = normalizeFillsForHoldingsBasis(fills, "2026-10-01", () => "PETR4", factors);
    expect(result.fills).toEqual(fills);
    expect(result.skippedHoldingKeys).toEqual(new Set([holdingKeyOf(first)]));
  });
});
