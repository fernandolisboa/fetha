import { describe, expect, it } from "vitest";

import { themeSchema, themes } from "./theme";

describe("themeSchema", () => {
  it("accepts the three shipped themes", () => {
    for (const theme of themes) {
      expect(themeSchema.parse(theme)).toBe(theme);
    }
  });

  it("defaults to instrumento when unset", () => {
    expect(themeSchema.parse(undefined)).toBe("instrumento");
  });

  it("rejects unknown values", () => {
    expect(themeSchema.safeParse("cyberpunk").success).toBe(false);
  });
});
