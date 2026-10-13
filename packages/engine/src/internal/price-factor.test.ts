import { describe, expect, it } from "vitest";
import { decimalString } from "../test/support";
import { resolvePriceFactor } from "./price-factor";

describe("resolvePriceFactor", () => {
  it("defaults an absent factor to 1 (every equity option, pre-existing behaviour)", () => {
    const result = resolvePriceFactor(undefined, "optionSeries.priceFactor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toNumber()).toBe(1);
  });

  it("resolves a given positive factor (an index option's own PricFctr)", () => {
    const result = resolvePriceFactor(decimalString("100"), "optionSeries.priceFactor");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.toNumber()).toBe(100);
  });

  it("rejects a zero factor as invalid_input", () => {
    const result = resolvePriceFactor(decimalString("0"), "optionSeries.priceFactor");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "optionSeries.priceFactor",
      message: "a series price factor must be positive",
    });
  });

  it("rejects a negative factor as invalid_input", () => {
    const result = resolvePriceFactor(decimalString("-1"), "optionSeries.priceFactor");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });
});
