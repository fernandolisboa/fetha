import { describe, expect, it } from "vitest";

import { layoutSchema, layouts } from "./layout";

describe("layoutSchema", () => {
  it("accepts both shipped layouts", () => {
    for (const layout of layouts) {
      expect(layoutSchema.parse(layout)).toBe(layout);
    }
  });

  it("defaults to workspace when unset", () => {
    expect(layoutSchema.parse(undefined)).toBe("workspace");
  });

  it("rejects unknown values", () => {
    expect(layoutSchema.safeParse("cockpit").success).toBe(false);
  });
});
