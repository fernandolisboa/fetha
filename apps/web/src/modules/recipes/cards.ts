import type { Centavos, ExpectedMove, IvRegime } from "@fetha/contracts";

import { formatBRL } from "@/lib/format/brl";
import { catalog, recipes } from "@/modules/strategies";

import { payoffSketch, type SketchPoint } from "./payoff-sketch";
import { recipeRiskFractions, riskBudget, type RecipeRiskFraction } from "./risk";
import { t } from "./strings";

export type RecipeCard = {
  id: string;
  expectedMove: ExpectedMove;
  ivRegime: IvRegime;
  name: string;
  summary: string;
  maxLoss: string;
  sketch: SketchPoint[];
};

export type RiskOption = { fraction: RecipeRiskFraction; label: string; amount: string };

function copyFor(id: string): { summary: string; maxLoss: string } {
  const copy = (t.recipes as Record<string, { summary: string; maxLoss: string } | undefined>)[id];
  if (!copy) {
    throw new Error(`recipe ${id} has no copy`);
  }
  return copy;
}

export function recipeCards(): RecipeCard[] {
  return recipes.map((recipe) => {
    const structure = catalog.find(
      (entry) => entry.structure.id === recipe.definition.structureId,
    )?.structure;
    if (!structure) {
      throw new Error(`recipe ${recipe.id} names no catalog structure`);
    }
    return {
      id: recipe.id,
      expectedMove: recipe.expectedMove,
      ivRegime: recipe.ivRegime,
      name: recipe.definition.name,
      ...copyFor(recipe.id),
      sketch: payoffSketch(structure, recipe.definition.strikes),
    };
  });
}

export function riskOptions(declaredCapital: Centavos): RiskOption[] {
  return recipeRiskFractions.map((fraction) => ({
    fraction,
    label: t.picker.risks[fraction],
    amount: t.picker.riskAmount.replace(
      "{amount}",
      formatBRL(riskBudget(declaredCapital, fraction)),
    ),
  }));
}
