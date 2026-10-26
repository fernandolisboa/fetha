import type { Recipe, Structure } from "@fetha/contracts";

import { catalog } from "@/modules/strategies";

export function recipeStructure(recipe: Recipe): Structure | null {
  return (
    catalog.find((entry) => entry.structure.id === recipe.definition.structureId)?.structure ?? null
  );
}
