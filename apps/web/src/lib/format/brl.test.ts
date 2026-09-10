import { centavosSchema, decimalStringSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";
import { formatBRL, formatPriceBRL, parseBRLToCentavos } from "./brl";

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

describe("formatPriceBRL", () => {
  it("formats a six-decimal candle price rounded to centavos", () => {
    expect(formatPriceBRL(decimalStringSchema.parse("10.750000"))).toBe("R$ 10,75");
  });

  it("rounds half up at the third decimal", () => {
    expect(formatPriceBRL(decimalStringSchema.parse("10.755"))).toBe("R$ 10,76");
  });

  it("formats a price with thousands separators", () => {
    expect(formatPriceBRL(decimalStringSchema.parse("1234.5"))).toBe("R$ 1.234,50");
  });
});

describe("parseBRLToCentavos", () => {
  it("parses a thousands-separated amount", () => {
    expect(parseBRLToCentavos("1.234,56")).toBe(123456);
  });

  it("parses an amount without thousands separators", () => {
    expect(parseBRLToCentavos("50000,00")).toBe(5000000);
  });

  it("parses a whole amount without cents", () => {
    expect(parseBRLToCentavos("1234")).toBe(123400);
  });

  it("rejects zero", () => {
    expect(parseBRLToCentavos("0")).toBeNull();
  });

  it("rejects a negative amount", () => {
    expect(parseBRLToCentavos("-10,00")).toBeNull();
  });

  it("rejects an empty or non-numeric input", () => {
    expect(parseBRLToCentavos("")).toBeNull();
    expect(parseBRLToCentavos("abc")).toBeNull();
  });
});
