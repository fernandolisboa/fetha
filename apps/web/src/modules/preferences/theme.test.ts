import { describe, expect, it } from "vitest";

import { themeMode, themeSchema, themes } from "./theme";

describe("themeSchema", () => {
  it("accepts every shipped theme", () => {
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

describe("themeMode", () => {
  it("marks papel as the only light theme", () => {
    expect(themes.filter((theme) => themeMode(theme) === "light")).toEqual(["papel"]);
  });
});
