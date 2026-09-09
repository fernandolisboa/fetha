import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";
import { parseDecimal, PRICE_SCALE, RATIO_SCALE, toDecimalString } from "./decimal";

describe("toDecimalString", () => {
  it("formats a price at scale 2", () => {
    expect(toDecimalString(new Decimal("12.3"), PRICE_SCALE)).toBe("12.30");
  });

  it("formats a ratio at scale 6", () => {
    expect(toDecimalString(new Decimal("0.5"), RATIO_SCALE)).toBe("0.500000");
  });

  it("never emits a negative zero", () => {
    expect(toDecimalString(new Decimal("-0.00001"), PRICE_SCALE)).toBe("0.00");
    expect(toDecimalString(new Decimal(0).neg(), PRICE_SCALE)).toBe("0.00");
  });

  it("keeps the sign of a genuinely negative value", () => {
    expect(toDecimalString(new Decimal("-1.5"), PRICE_SCALE)).toBe("-1.50");
  });

  it("throws for a non-finite value instead of emitting Infinity or NaN as a string", () => {
    expect(() => toDecimalString(new Decimal(Infinity), PRICE_SCALE)).toThrow();
    expect(() => toDecimalString(new Decimal(-Infinity), PRICE_SCALE)).toThrow();
    expect(() => toDecimalString(new Decimal(NaN), PRICE_SCALE)).toThrow();
  });
});

describe("parseDecimal", () => {
  it("round-trips a DecimalString into a Decimal", () => {
    const value = "12.34" as DecimalString;
    expect(parseDecimal(value).toString()).toBe("12.34");
  });
});
