import { recipeBookSchema, type Recipe } from "@fetha/contracts";

import recipesJson from "./recipes.json";

// docs/adr/0064: the shared, read-only recipe file next to the catalog.
export const recipes: readonly Recipe[] = recipeBookSchema.parse(recipesJson);

export function recipeById(id: string): Recipe | null {
  return recipes.find((recipe) => recipe.id === id) ?? null;
}
