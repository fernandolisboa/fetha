import { centavosSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";
import { formatBRL } from "./brl";

describe("formatBRL", () => {
  it("formats a positive amount with thousands separators", () => {
    expect(formatBRL(centavosSchema.parse(123456))).toBe("R$ 1.234,56");
  });

  it("formats a value under a thousand", () => {
    expect(formatBRL(centavosSchema.parse(4256))).toBe("R$ 42,56");
  });

  it("formats zero", () => {
    expect(formatBRL(centavosSchema.parse(0))).toBe("R$ 0,00");
  });

  it("formats negative zero without a minus sign", () => {
    expect(formatBRL(centavosSchema.parse(-0))).toBe("R$ 0,00");
  });

  it("formats a negative amount with the true minus sign (U+2212)", () => {
    expect(formatBRL(centavosSchema.parse(-123456))).toBe("−R$ 1.234,56");
  });

  it("pads single-digit centavos", () => {
    expect(formatBRL(centavosSchema.parse(105))).toBe("R$ 1,05");
  });
});
