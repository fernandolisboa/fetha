import { decimalStringSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { formatProbabilityOfProfit } from "./probability-of-profit";

describe("formatProbabilityOfProfit", () => {
  it("rounds half up to a whole percent", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.3588"))).toBe("36%");
  });

  it("formats an exact half percent", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.5"))).toBe("50%");
  });

  it("shows '< 1%' just below the one-percent floor", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.0049"))).toBe("< 1%");
  });

  it("shows '< 1%' at zero", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0"))).toBe("< 1%");
  });

  it("shows a whole percent just at the one-percent floor", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.005"))).toBe("1%");
  });

  it("shows '> 99%' at the ninety-nine-point-five-percent ceiling", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.9950"))).toBe("> 99%");
  });

  it("shows '> 99%' at one", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("1"))).toBe("> 99%");
  });

  it("shows a whole percent just below the ninety-nine-point-five-percent ceiling", () => {
    expect(formatProbabilityOfProfit(decimalStringSchema.parse("0.9949"))).toBe("99%");
  });
});
