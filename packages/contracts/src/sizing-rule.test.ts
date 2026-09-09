import { describe, expect, it } from "vitest";
import { sizingRuleKinds, sizingRuleSchema } from "./sizing-rule";

describe("sizingRuleSchema", () => {
  it("lists both sizing rule kinds", () => {
    expect(sizingRuleKinds).toEqual(["fixed_fractional", "fixed_risk"]);
  });

  it("parses every listed kind with a fraction", () => {
    for (const kind of sizingRuleKinds) {
      expect(sizingRuleSchema.parse({ kind, fraction: "0.02" })).toEqual({
        kind,
        fraction: "0.02",
      });
    }
  });

  it("rejects unknown kinds, numeric fractions and missing fractions", () => {
    expect(sizingRuleSchema.safeParse({ kind: "kelly", fraction: "0.5" }).success).toBe(false);
    expect(sizingRuleSchema.safeParse({ kind: "fixed_risk", fraction: 0.02 }).success).toBe(false);
    expect(sizingRuleSchema.safeParse({ kind: "fixed_fractional" }).success).toBe(false);
  });
});
