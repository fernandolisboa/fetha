import { describe, expect, it, vi } from "vitest";

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
  it("shows each operand's own observed value right next to it, when asked to", () => {
    const recipe = recipes.find((entry) => entry.id === "bull-call-spread-low-iv");
    const lines =
      recipe &&
      conditionLines(recipe.definition.entry, 0, (operand) => {
        if (operand.kind === "price") return "R$ 43,17";
        if (operand.kind === "indicator" && operand.indicator.kind === "sma") return "R$ 41,90";
        return null;
      });
    expect(lines).toEqual([
      { text: "Fechamento R$ 43,17 > Média de 50 sessões R$ 41,90", depth: 0 },
      { text: "RSI 14 < 70", depth: 0 },
      { text: "Ranking de IV (63 sessões) < 50", depth: 0 },
    ]);
  });

  it("never asks for a constant operand's observed value: a constant already prints as itself", () => {
    const observe = vi.fn(() => "should never be used");
    conditionLines(
      conditionSchema.parse({
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "rsi", length: 14 } },
        comparator: "<",
        right: { kind: "constant", value: "70" },
      }),
      0,
      observe,
    );
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith({
      kind: "indicator",
      indicator: { kind: "rsi", length: 14 },
    });
  });

  it("prints a comparison plainly when the facts have no reading for either side", () => {
    const recipe = recipes.find((entry) => entry.id === "bull-call-spread-low-iv");
    const lines = recipe && conditionLines(recipe.definition.entry, 0, () => null);
    expect(lines?.[0]?.text).toBe("Fechamento > Média de 50 sessões");
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
