import { decimalStringSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { formatDecimal } from "./decimal";

describe("formatDecimal", () => {
  it("formats with two decimals by default, comma separated", () => {
    expect(formatDecimal(decimalStringSchema.parse("38.4"))).toBe("38,40");
  });

  it("formats with a custom number of decimals", () => {
    expect(formatDecimal(decimalStringSchema.parse("0.3421"), 4)).toBe("0,3421");
  });

  it("formats a positive ratio with a comma decimal", () => {
    expect(formatDecimal(decimalStringSchema.parse("5.165050"))).toBe("5,17");
  });

  it("formats a negative ratio with a true minus sign", () => {
    expect(formatDecimal(decimalStringSchema.parse("-1.5"))).toBe("−1,50");
  });

  it("formats zero without a sign", () => {
    expect(formatDecimal(decimalStringSchema.parse("0"))).toBe("0,00");
  });

  it("does not sign a value that rounds to zero at the requested precision", () => {
    expect(formatDecimal(decimalStringSchema.parse("-0.00001"))).toBe("0,00");
  });
});
