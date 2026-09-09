import { describe, expect, it } from "vitest";
import { toCentavos, toQuantity } from "./scalars";

describe("toQuantity", () => {
  it("brands a positive integer", () => {
    expect(toQuantity(5)).toBe(5);
  });

  it("throws for a non-positive value", () => {
    expect(() => toQuantity(0)).toThrow();
    expect(() => toQuantity(-1)).toThrow();
  });

  it("throws for a non-integer value", () => {
    expect(() => toQuantity(1.5)).toThrow();
  });

  it("throws for a non-finite value", () => {
    expect(() => toQuantity(Infinity)).toThrow();
    expect(() => toQuantity(NaN)).toThrow();
  });
});

describe("toCentavos", () => {
  it("brands an integer, negative or zero included", () => {
    expect(toCentavos(-100)).toBe(-100);
    expect(toCentavos(0)).toBe(0);
  });

  it("throws for a non-integer value", () => {
    expect(() => toCentavos(1.5)).toThrow();
  });

  it("throws for a non-finite value", () => {
    expect(() => toCentavos(Infinity)).toThrow();
    expect(() => toCentavos(-Infinity)).toThrow();
    expect(() => toCentavos(NaN)).toThrow();
  });
});
