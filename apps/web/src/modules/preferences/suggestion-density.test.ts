import { describe, expect, it } from "vitest";

import { suggestionDensities, suggestionDensitySchema } from "./suggestion-density";

describe("suggestionDensitySchema", () => {
  it("accepts every shipped density", () => {
    for (const density of suggestionDensities) {
      expect(suggestionDensitySchema.parse(density)).toBe(density);
    }
  });

  it("defaults to full when unset", () => {
    expect(suggestionDensitySchema.parse(undefined)).toBe("full");
  });

  it("rejects unknown values", () => {
    expect(suggestionDensitySchema.safeParse("cozy").success).toBe(false);
  });
});
