import { describe, expect, it } from "vitest";

import { timingSafeEqualStrings } from "./timing-safe-equal-strings";

describe("timingSafeEqualStrings", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStrings("e2e-secret", "e2e-secret")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(timingSafeEqualStrings("e2e-secreu", "e2e-secret")).toBe(false);
  });

  it("returns false, not throw, when a multibyte header has the same UTF-16 length but a different byte length", () => {
    const configured = "aaaa";
    const provided = "aaaé";

    expect(configured.length).toBe(provided.length);
    expect(Buffer.byteLength(configured)).not.toBe(Buffer.byteLength(provided));
    expect(() => timingSafeEqualStrings(provided, configured)).not.toThrow();
    expect(timingSafeEqualStrings(provided, configured)).toBe(false);
  });
});
