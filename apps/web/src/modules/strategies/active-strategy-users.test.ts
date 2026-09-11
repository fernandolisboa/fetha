import { describe, expect, it } from "vitest";

import { rotationOffset } from "./active-strategy-users";

describe("rotationOffset", () => {
  it("is stable: the same key and length always produce the same offset", () => {
    const first = rotationOffset("2026-09-09", 5);
    const second = rotationOffset("2026-09-09", 5);
    expect(first).toBe(second);
  });

  it("stays within [0, length)", () => {
    for (const key of ["2026-09-09", "2026-09-10", "", "x"]) {
      const offset = rotationOffset(key, 7);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(7);
    }
  });

  it("rotates to a different starting point for a different session", () => {
    const offsets = new Set(
      ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((key) =>
        rotationOffset(key, 5),
      ),
    );
    expect(offsets.size).toBeGreaterThan(1);
  });

  it("returns 0 for a non-positive length", () => {
    expect(rotationOffset("2026-09-09", 0)).toBe(0);
  });
});
