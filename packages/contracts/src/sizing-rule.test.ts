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

  it("accepts the whole capital as a fraction of one", () => {
    expect(sizingRuleSchema.safeParse({ kind: "fixed_fractional", fraction: "1" }).success).toBe(
      true,
    );
  });

  it("rejects fractions of zero, above one or negative", () => {
    for (const kind of sizingRuleKinds) {
      for (const fraction of ["0", "0.0", "1.5", "2", "-0.02"]) {
        expect(sizingRuleSchema.safeParse({ kind, fraction }).success).toBe(false);
      }
    }
  });

  it("rejects unknown kinds, numeric fractions and missing fractions", () => {
    expect(sizingRuleSchema.safeParse({ kind: "kelly", fraction: "0.5" }).success).toBe(false);
    expect(sizingRuleSchema.safeParse({ kind: "fixed_risk", fraction: 0.02 }).success).toBe(false);
    expect(sizingRuleSchema.safeParse({ kind: "fixed_fractional" }).success).toBe(false);
  });
});
