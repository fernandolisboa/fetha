import { decimalStringSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { formatPercent, fractionToPercentInputValue, parsePercentToFraction } from "./percent";

describe("formatPercent", () => {
  it("formats a whole percent", () => {
    expect(formatPercent(decimalStringSchema.parse("0.02"))).toBe("2%");
  });

  it("formats a percent with a decimal, comma separated", () => {
    expect(formatPercent(decimalStringSchema.parse("0.025"))).toBe("2,5%");
  });

  it("formats 100%", () => {
    expect(formatPercent(decimalStringSchema.parse("1"))).toBe("100%");
  });

  it("formats a positive fraction with a comma decimal", () => {
    expect(formatPercent(decimalStringSchema.parse("0.0208"))).toBe("2,08%");
  });

  it("formats a negative fraction with a true minus sign", () => {
    expect(formatPercent(decimalStringSchema.parse("-0.015"))).toBe("−1,5%");
  });

  it("formats zero without a sign", () => {
    expect(formatPercent(decimalStringSchema.parse("0"))).toBe("0%");
  });

  it("drops a trailing zero rather than forcing two decimals", () => {
    expect(formatPercent(decimalStringSchema.parse("0.284"))).toBe("28,4%");
  });

  it("shows no sign for a negative fraction that rounds to zero", () => {
    expect(formatPercent(decimalStringSchema.parse("-0.0000001"))).toBe("0%");
  });
});

describe("fractionToPercentInputValue", () => {
  it("preserves precision beyond two decimals", () => {
    expect(fractionToPercentInputValue(decimalStringSchema.parse("0.02345"))).toBe("2,345");
  });

  it("trims a whole percent to no decimals", () => {
    expect(fractionToPercentInputValue(decimalStringSchema.parse("0.02"))).toBe("2");
  });
});

describe("parsePercentToFraction", () => {
  it("parses a whole percent", () => {
    expect(parsePercentToFraction("2")).toBe("0.02");
  });

  it("parses a comma-decimal percent", () => {
    expect(parsePercentToFraction("2,5")).toBe("0.025");
  });

  it("parses 100 as the fraction 1", () => {
    expect(parsePercentToFraction("100")).toBe("1");
  });

  it("rejects 0", () => {
    expect(parsePercentToFraction("0")).toBeNull();
  });

  it("rejects a value above 100", () => {
    expect(parsePercentToFraction("101")).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(parsePercentToFraction("-2")).toBeNull();
  });

  it("rejects a non-numeric input", () => {
    expect(parsePercentToFraction("abc")).toBeNull();
  });
});
