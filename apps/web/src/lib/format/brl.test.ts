import { describe, expect, it } from "vitest";
import { formatBRL, NonIntegerCentavosError } from "./brl";

describe("formatBRL", () => {
  it("formats a positive amount with thousands separators", () => {
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });

  it("formats a value under a thousand", () => {
    expect(formatBRL(4256)).toBe("R$ 42,56");
  });

  it("formats zero", () => {
    expect(formatBRL(0)).toBe("R$ 0,00");
  });

  it("formats a negative amount with the true minus sign (U+2212)", () => {
    expect(formatBRL(-123456)).toBe("−R$ 1.234,56");
  });

  it("pads single-digit centavos", () => {
    expect(formatBRL(105)).toBe("R$ 1,05");
  });

  it("throws NonIntegerCentavosError for a non-integer amount", () => {
    expect(() => formatBRL(10.5)).toThrow(NonIntegerCentavosError);
  });

  it("carries the offending amount on the error", () => {
    try {
      formatBRL(1.1);
      throw new Error("expected formatBRL to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(NonIntegerCentavosError);
      expect((error as NonIntegerCentavosError).centavos).toBe(1.1);
    }
  });
});
