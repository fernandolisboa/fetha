import { describe, expect, it } from "vitest";
import { centavosSchema } from "@fetha/contracts";

import { recipes } from "@/modules/strategies";

import { recipeCards, riskOptions } from "./cards";
import { recipesStrings } from "./strings";

describe("recipeCards", () => {
  it("gives every recipe its copy in both locales and a sketch", () => {
    const cards = recipeCards();

    expect(cards.map((card) => card.id)).toEqual(recipes.map((recipe) => recipe.id));
    for (const card of cards) {
      expect(card.summary).not.toBe("");
      expect(card.maxLoss).not.toBe("");
      expect(card.sketch.length).toBeGreaterThan(2);
    }
    expect(Object.keys(recipesStrings.en.recipes).sort()).toEqual(
      recipes.map((recipe) => recipe.id).sort(),
    );
  });
});

describe("riskOptions", () => {
  it("states each fraction's budget in reais", () => {
    const options = riskOptions(centavosSchema.parse(1_000_000));

    expect(options.map((option) => option.amount)).toEqual([
      "cerca de R$ 100,00",
      "cerca de R$ 200,00",
      "cerca de R$ 500,00",
    ]);
  });
});
