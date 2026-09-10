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
    expect(formatPercent(decimalString("-0.015"))).toBe("−1,5%");
  });

  it("formats zero without a sign", () => {
    expect(formatPercent(decimalString("0"))).toBe("0%");
  });

  // DESIGN.md "Formatting (pt-BR)": "at most two decimals (2,08%, 28,4%)",
  // i.e. no forced trailing zero.
  it("drops a trailing zero rather than forcing two decimals", () => {
    expect(formatPercent(decimalString("0.284"))).toBe("28,4%");
  });

  // A value so small it rounds to 0,00% at two decimals must never show a
  // sign: the sign has to come from the rounded value, not the raw one.
  it("shows no sign for a negative fraction that rounds to zero", () => {
    expect(formatPercent(decimalString("-0.0000001"))).toBe("0%");
  });
});
