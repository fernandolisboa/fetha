import { describe, expect, it } from "vitest";
import { adjustmentRuleKinds, adjustmentRuleSchema } from "./adjustment-rule";

const roll = {
  kind: "roll",
  when: { kind: "days_before_expiry", businessDays: 5 },
  expiry: { kind: "business_days", min: 20, max: 45 },
  strikes: [{ kind: "delta", target: "0.30" }],
};

describe("adjustmentRuleSchema", () => {
  it("lists roll as the only adjustment kind", () => {
    expect(adjustmentRuleKinds).toEqual(["roll"]);
  });

  it("accepts a roll triggered by an exit rule", () => {
    expect(adjustmentRuleSchema.parse(roll)).toEqual(roll);
  });

  it("rejects a roll with no strike selections", () => {
    expect(adjustmentRuleSchema.safeParse({ ...roll, strikes: [] }).success).toBe(false);
  });

  it("rejects unknown kinds and a roll without a trigger", () => {
    expect(adjustmentRuleSchema.safeParse({ ...roll, kind: "hedge" }).success).toBe(false);
    const withoutTrigger = Object.fromEntries(
      Object.entries(roll).filter(([key]) => key !== "when"),
    );
    expect(adjustmentRuleSchema.safeParse(withoutTrigger).success).toBe(false);
  });

  it("rejects an invalid target expiry window", () => {
    expect(
      adjustmentRuleSchema.safeParse({
        ...roll,
        expiry: { kind: "business_days", min: 50, max: 20 },
      }).success,
    ).toBe(false);
  });
});
