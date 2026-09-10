import { describe, expect, it } from "vitest";

import { isValidWholeNumber } from "./is-valid-whole-number";

describe("isValidWholeNumber", () => {
  it("rejects an empty or blank string, the state a cleared field ends up in", () => {
    expect(isValidWholeNumber("")).toBe(false);
    expect(isValidWholeNumber("   ")).toBe(false);
  });

  it("accepts a whole number with no min", () => {
    expect(isValidWholeNumber("3")).toBe(true);
    expect(isValidWholeNumber("0")).toBe(true);
    expect(isValidWholeNumber("-5")).toBe(true);
  });

  it("rejects a non-integer or non-numeric string", () => {
    expect(isValidWholeNumber("3.5")).toBe(false);
    expect(isValidWholeNumber("abc")).toBe(false);
  });

  it("enforces min when given", () => {
    expect(isValidWholeNumber("0", 1)).toBe(false);
    expect(isValidWholeNumber("1", 1)).toBe(true);
    expect(isValidWholeNumber("-1", 0)).toBe(false);
  });
});
