import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";

import { formatPercent } from "./percent";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

describe("formatPercent", () => {
  it("formats a positive fraction with a comma decimal", () => {
    expect(formatPercent(decimalString("0.0208"))).toBe("2,08%");
  });

  it("formats a negative fraction with a true minus sign", () => {
    expect(formatPercent(decimalString("-0.015"))).toBe("−1,50%");
  });

  it("formats zero without a sign", () => {
    expect(formatPercent(decimalString("0"))).toBe("0,00%");
  });
});
