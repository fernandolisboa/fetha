import { describe, expect, it } from "vitest";
import { planRulesSchema } from "./plan-rule";

const validLeg = {
  role: "call" as const,
  side: "buy" as const,
  ticker: "PETRA36" as never,
  quantity: 100 as never,
};

function baseRules() {
  return {
    recipeId: "covered-call",
    summary: "Fetha built this.",
    exitRules: [{ rule: { kind: "profit_target", fractionOfPremium: "0.500000" }, session: null }],
    roll: { applies: false, session: null },
    original: { legs: [validLeg], lots: 1 },
  };
}

describe("planRulesSchema", () => {
  it("accepts rules with the plan's own original legs and lots", () => {
    const parsed = planRulesSchema.parse(baseRules());
    expect(parsed.original?.lots).toBe(1);
    expect(parsed.original?.legs).toHaveLength(1);
  });

  it("accepts rules with no original (a plan saved before ticket #380 shipped)", () => {
    const withoutOriginal: Record<string, unknown> = baseRules();
    delete withoutOriginal.original;
    const parsed = planRulesSchema.parse(withoutOriginal);
    expect(parsed.original).toBeUndefined();
  });

  it("rejects an original with no legs", () => {
    const rules = baseRules();
    rules.original.legs = [];
    expect(() => planRulesSchema.parse(rules)).toThrow();
  });
});
