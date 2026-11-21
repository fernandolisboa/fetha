import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DecimalString } from "@fetha/contracts";

import { limitPriceForLeg } from "./limit-price";

function price(value: string): DecimalString {
  return value as DecimalString;
}

describe("limitPriceForLeg", () => {
  it("raises a buy's limit above the last price by the tolerance", () => {
    expect(limitPriceForLeg("buy", price("2.000000"), price("0.010000"))).toBe("2.020000");
  });

  it("lowers a sell's limit below the last price by the tolerance", () => {
    expect(limitPriceForLeg("sell", price("2.000000"), price("0.010000"))).toBe("1.980000");
  });

  it("never prices a leg below zero", () => {
    expect(limitPriceForLeg("sell", price("0.010000"), price("5.000000"))).toBe("0.000000");
  });

  it("a buy's limit is never below the last price, a sell's never above it (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        fc.constantFrom("buy", "sell"),
        (lastPriceCents, toleranceBps, side) => {
          const lastPrice = price((lastPriceCents / 100).toFixed(6));
          const tolerance = price((toleranceBps / 1_000_000).toFixed(6));
          const limit = Number(limitPriceForLeg(side, lastPrice, tolerance));
          if (side === "buy") {
            expect(limit).toBeGreaterThanOrEqual(Number(lastPrice));
          } else {
            expect(limit).toBeLessThanOrEqual(Number(lastPrice));
          }
        },
      ),
    );
  });
});
