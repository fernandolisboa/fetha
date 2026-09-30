import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decimalStringSchema, quantitySchema, type Quantity } from "@fetha/contracts";

import { isNeutralFactor, sharesRatioToFactor } from "./corporate-action-factor";

function qty(value: number): Quantity {
  return quantitySchema.parse(value);
}

describe("sharesRatioToFactor", () => {
  it.each([
    [1, 2, "0.50000000"],
    [100, 1, "100.00000000"],
    [4, 5, "0.80000000"],
    [1, 3, "0.33333333"],
    [1, 1, "1.00000000"],
  ])("converts %i-for-%i to factor %s", (sharesBefore, sharesAfter, expected) => {
    expect(sharesRatioToFactor(qty(sharesBefore), qty(sharesAfter))).toBe(expected);
  });

  it("is always strictly positive", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (sharesBefore, sharesAfter) => {
          const factor = new Decimal(sharesRatioToFactor(qty(sharesBefore), qty(sharesAfter)));
          expect(factor.isPositive()).toBe(true);
        },
      ),
    );
  });

  it("recovers sharesBefore from factor * sharesAfter within the rounding bound", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (sharesBefore, sharesAfter) => {
          const factor = new Decimal(sharesRatioToFactor(qty(sharesBefore), qty(sharesAfter)));
          const recovered = factor.times(sharesAfter);
          const roundingBound = new Decimal(sharesAfter).times("0.000000005");
          expect(recovered.minus(sharesBefore).abs().lte(roundingBound)).toBe(true);
        },
      ),
    );
  });
});

describe("isNeutralFactor", () => {
  it("treats 1.00000000 (a 1-to-1 entry, the documented undo) as neutral", () => {
    expect(isNeutralFactor(decimalStringSchema.parse("1.00000000"))).toBe(true);
  });

  it.each(["0.50000000", "100.00000000", "0.80000000"])("treats %s as not neutral", (factor) => {
    expect(isNeutralFactor(decimalStringSchema.parse(factor))).toBe(false);
  });
});
