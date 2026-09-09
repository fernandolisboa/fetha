import { describe, expect, it } from "vitest";
import { exitRuleKinds, exitRuleSchema } from "./exit-rule";

describe("exitRuleSchema", () => {
  it("lists every exit rule kind", () => {
    expect(exitRuleKinds).toEqual([
      "profit_target",
      "stop_loss",
      "days_before_expiry",
      "condition",
    ]);
  });

  it("parses every listed kind", () => {
    const samples = {
      profit_target: { kind: "profit_target", fractionOfPremium: "0.5" },
      stop_loss: { kind: "stop_loss", multipleOfMaxLoss: "0.5" },
      days_before_expiry: { kind: "days_before_expiry", businessDays: 5 },
      condition: {
        kind: "condition",
        condition: {
          kind: "compare",
          left: { kind: "price", field: "close" },
          comparator: "<",
          right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
        },
      },
    } satisfies Record<(typeof exitRuleKinds)[number], unknown>;
    for (const kind of exitRuleKinds) {
      expect(exitRuleSchema.safeParse(samples[kind]).success).toBe(true);
    }
  });

  it("rejects unknown kinds and negative days", () => {
    expect(exitRuleSchema.safeParse({ kind: "trailing_stop", fraction: "0.1" }).success).toBe(
      false,
    );
    expect(exitRuleSchema.safeParse({ kind: "days_before_expiry", businessDays: -1 }).success).toBe(
      false,
    );
  });

  it("rejects numeric fractions", () => {
    expect(
      exitRuleSchema.safeParse({ kind: "profit_target", fractionOfPremium: 0.5 }).success,
    ).toBe(false);
  });
});
