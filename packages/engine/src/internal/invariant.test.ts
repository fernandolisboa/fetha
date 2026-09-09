import { describe, expect, it } from "vitest";
import { assertDefined, assertPresent } from "./invariant";

describe("assertDefined", () => {
  it("returns the value when it is not undefined, including null", () => {
    expect(assertDefined(1, "unreachable")).toBe(1);
    expect(assertDefined(null, "unreachable")).toBeNull();
  });

  it("throws with the given message when undefined", () => {
    expect(() => {
      assertDefined(undefined, "was undefined");
    }).toThrow("was undefined");
  });
});

describe("assertPresent", () => {
  it("returns the value when it is neither null nor undefined", () => {
    expect(assertPresent(1, "unreachable")).toBe(1);
    expect(assertPresent(0, "unreachable")).toBe(0);
    expect(assertPresent("", "unreachable")).toBe("");
  });

  it("throws with the given message when null", () => {
    expect(() => {
      assertPresent(null, "was null");
    }).toThrow("was null");
  });

  it("throws with the given message when undefined", () => {
    expect(() => {
      assertPresent(undefined, "was undefined");
    }).toThrow("was undefined");
  });
});
