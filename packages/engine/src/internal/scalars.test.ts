import { describe, expect, it } from "vitest";
import { toCentavos, toQuantity } from "./scalars";

describe("toQuantity", () => {
  it("brands a positive integer through quantitySchema", () => {
    expect(toQuantity(5)).toBe(5);
  });

  it("throws for a non-positive value, per quantitySchema's real validation", () => {
    expect(() => toQuantity(0)).toThrow();
    expect(() => toQuantity(-1)).toThrow();
  });

  it("throws for a non-integer value", () => {
    expect(() => toQuantity(1.5)).toThrow();
  });
});

describe("toCentavos", () => {
  it("brands an integer through centavosSchema", () => {
    expect(toCentavos(-100)).toBe(-100);
    expect(toCentavos(0)).toBe(0);
  });

  it("throws for a non-integer value, per centavosSchema's real validation", () => {
    expect(() => toCentavos(1.5)).toThrow();
  });
});
