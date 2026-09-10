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

  it("formats a negative value", () => {
    expect(formatDecimal(decimalStringSchema.parse("-1.5"))).toBe("-1,50");
  });
});
