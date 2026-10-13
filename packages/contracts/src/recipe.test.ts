import { describe, expect, it } from "vitest";
import { recipeBookSchema, recipeSchema } from "./recipe";

const bullCallSpread = {
  id: "bull-call-spread-low-iv",
  expectedMove: "up",
  ivRegime: "low",
  definition: {
    name: "Trava de alta com calls",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
    },
    structureId: "bull-call-spread",
    strikes: [
      { kind: "moneyness", percent: "0" },
      { kind: "moneyness", percent: "0.05" },
    ],
    expiry: { kind: "business_days", min: 15, max: 45 },
    sizing: { kind: "fixed_risk", fraction: "0.02" },
    exit: [{ kind: "days_before_expiry", businessDays: 5 }],
    adjustments: [],
  },
  reference: "Hull, ch. 12, Spreads",
  notes: "Debit spread.",
};

describe("recipeSchema", () => {
  it("accepts a complete definition with its expected move, IV regime and source", () => {
    expect(recipeSchema.safeParse(bullCallSpread).success).toBe(true);
  });

  it("refuses a definition that does not size by fixed_risk", () => {
    expect(
      recipeSchema.safeParse({
        ...bullCallSpread,
        definition: {
          ...bullCallSpread.definition,
          sizing: { kind: "fixed_fractional", fraction: "0.02" },
        },
      }).success,
    ).toBe(false);
  });

  it("refuses a definition past the write-edge indicator bounds", () => {
    expect(
      recipeSchema.safeParse({
        ...bullCallSpread,
        definition: {
          ...bullCallSpread.definition,
          entry: {
            ...bullCallSpread.definition.entry,
            right: { kind: "indicator", indicator: { kind: "sma", length: 501 } },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown expected move, an id that is not kebab-case and an empty source", () => {
    expect(recipeSchema.safeParse({ ...bullCallSpread, expectedMove: "flat" }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...bullCallSpread, id: "Bull Call" }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...bullCallSpread, reference: "" }).success).toBe(false);
  });
});

describe("recipeBookSchema", () => {
  it("refuses duplicate ids and an empty book", () => {
    expect(recipeBookSchema.safeParse([bullCallSpread]).success).toBe(true);
    expect(recipeBookSchema.safeParse([bullCallSpread, bullCallSpread]).success).toBe(false);
    expect(recipeBookSchema.safeParse([]).success).toBe(false);
  });
});
