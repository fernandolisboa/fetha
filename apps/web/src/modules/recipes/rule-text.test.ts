import { describe, expect, it } from "vitest";

import { conditionSchema, exitRuleSchema } from "@fetha/contracts";

import { recipes } from "@/modules/strategies";

import { conditionLines, exitText } from "./rule-text";

describe("conditionLines", () => {
  it("reads a recipe's entry as one line per comparison", () => {
    const recipe = recipes.find((entry) => entry.id === "bull-call-spread-low-iv");
    expect(recipe && conditionLines(recipe.definition.entry)).toEqual([
      { text: "Fechamento > Média de 50 sessões", depth: 0 },
      { text: "RSI 14 < 70", depth: 0 },
      { text: "Ranking de IV (63 sessões) < 50", depth: 0 },
    ]);
  });

  it("names nested connectives and indents what they hold", () => {
    expect(
      conditionLines(
        conditionSchema.parse({
          kind: "or",
          conditions: [
            {
              kind: "not",
              condition: {
                kind: "compare",
                left: { kind: "price", field: "close" },
                comparator: ">=",
                right: { kind: "indicator", indicator: { kind: "ema", length: 9 } },
              },
            },
          ],
        }),
      ),
    ).toEqual([
      { text: "qualquer uma destas", depth: 0 },
      { text: "não", depth: 1 },
      { text: "Fechamento ≥ Média exponencial de 9 sessões", depth: 2 },
    ]);
  });
});

describe("exitText", () => {
  it("reads every exit kind every recipe uses", () => {
    expect(recipes.flatMap((recipe) => recipe.definition.exit.map(exitText)).every(Boolean)).toBe(
      true,
    );
    expect(exitText({ kind: "days_before_expiry", businessDays: 1 })).toBe(
      "1 sessão antes do vencimento",
    );
    expect(
      exitText(exitRuleSchema.parse({ kind: "profit_target", fractionOfPremium: "0.5" })),
    ).toBe("o ganho chega a 50% do prêmio");
  });
});
