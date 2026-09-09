import { describe, expect, it } from "vitest";
import { strikeSelectionKinds, strikeSelectionSchema } from "./strike-selection";

describe("strikeSelectionSchema", () => {
  it("lists every strike selection kind", () => {
    expect(strikeSelectionKinds).toEqual(["delta", "moneyness", "nearest"]);
  });

  it("accepts delta, moneyness and nearest", () => {
    expect(strikeSelectionSchema.safeParse({ kind: "delta", target: "0.30" }).success).toBe(true);
    expect(strikeSelectionSchema.safeParse({ kind: "moneyness", percent: "-0.05" }).success).toBe(
      true,
    );
    expect(strikeSelectionSchema.safeParse({ kind: "nearest", price: "40.00" }).success).toBe(true);
  });

  it("parses every listed kind", () => {
    const samples = {
      delta: { kind: "delta", target: "0.25" },
      moneyness: { kind: "moneyness", percent: "0.02" },
      nearest: { kind: "nearest", price: "38.50" },
    } satisfies Record<(typeof strikeSelectionKinds)[number], unknown>;
    for (const kind of strikeSelectionKinds) {
      expect(strikeSelectionSchema.safeParse(samples[kind]).success).toBe(true);
    }
  });

  it("rejects an unknown kind and numeric decimals", () => {
    expect(strikeSelectionSchema.safeParse({ kind: "atm" }).success).toBe(false);
    expect(strikeSelectionSchema.safeParse({ kind: "delta", target: 0.3 }).success).toBe(false);
  });

  it("rejects a parameter that belongs to another kind", () => {
    expect(strikeSelectionSchema.safeParse({ kind: "delta", price: "40.00" }).success).toBe(false);
  });
});
