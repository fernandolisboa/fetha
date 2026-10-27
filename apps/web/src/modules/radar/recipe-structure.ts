import type { Recipe, Structure } from "@fetha/contracts";

import { catalog, recipeById } from "@/modules/strategies";

export function recipeStructure(recipe: Recipe): Structure | null {
  return (
    catalog.find((entry) => entry.structure.id === recipe.definition.structureId)?.structure ?? null
  );
}

// The structure a recipe of the book builds, by its id; null when the recipe left the book.
export function recipeStructureById(recipeId: string): { id: string; name: string } | null {
  const recipe = recipeById(recipeId);
  const structure = recipe ? recipeStructure(recipe) : null;
  return structure ? { id: structure.id, name: structure.name } : null;
}
