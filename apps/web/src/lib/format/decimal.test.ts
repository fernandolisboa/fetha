import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";

import { formatDecimal } from "./decimal";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

describe("formatDecimal", () => {
  it("formats a positive ratio with a comma decimal", () => {
    expect(formatDecimal(decimalString("5.165050"))).toBe("5,17");
  });

  it("formats a negative ratio with a true minus sign", () => {
    expect(formatDecimal(decimalString("-1.5"))).toBe("−1,50");
  });

  it("formats zero without a sign", () => {
    expect(formatDecimal(decimalString("0"))).toBe("0,00");
  });
});
