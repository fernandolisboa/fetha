import { describe, expect, it } from "vitest";
import { catalogEntrySchema, catalogSchema } from "./catalog-entry";

const bullCallSpread = {
  structure: {
    id: "bull-call-spread",
    name: "Trava de alta com calls",
    expiry: "shared",
    legs: [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ],
  },
  defaults: {
    strikes: [
      { kind: "moneyness", percent: "0" },
      { kind: "moneyness", percent: "0.05" },
    ],
    expiry: { kind: "business_days", min: 15, max: 45 },
  },
  reference: "Hull, ch. 12, Spreads",
  notes: "Debit spread.",
};

describe("catalogEntrySchema", () => {
  it("accepts a structure with its defaults, source and notes", () => {
    expect(catalogEntrySchema.safeParse(bullCallSpread).success).toBe(true);
  });

  it("refuses defaults that select strikes with no expiry window", () => {
    expect(
      catalogEntrySchema.safeParse({
        ...bullCallSpread,
        defaults: { strikes: bullCallSpread.defaults.strikes },
      }).success,
    ).toBe(false);
  });

  it("refuses an entry with no source or an invalid structure", () => {
    expect(catalogEntrySchema.safeParse({ ...bullCallSpread, reference: "" }).success).toBe(false);
    expect(
      catalogEntrySchema.safeParse({
        ...bullCallSpread,
        structure: { ...bullCallSpread.structure, expiry: "per_leg" },
      }).success,
    ).toBe(false);
  });
});

describe("catalogSchema", () => {
  it("refuses two entries with the same structure id", () => {
    expect(catalogSchema.safeParse([bullCallSpread]).success).toBe(true);
    expect(catalogSchema.safeParse([bullCallSpread, bullCallSpread]).success).toBe(false);
  });
});
