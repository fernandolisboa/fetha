import type { IvRegime, Recipe } from "@fetha/contracts";

import { expectedMoveForView, type PlanView } from "./view";

// The recipe to copy for a stated view and the session's current IV regime (ticket #379): among
// the recipes whose expected move matches (every recipe, with "não sei"), an exact IV regime
// match wins, then the first recipe whose own regime is "any" (docs/adr/0064, every recipe
// accepts it); none when neither exists.
export function recipeForView(
  view: PlanView,
  ivRegime: IvRegime,
  recipes: readonly Recipe[],
): Recipe | null {
  const expectedMove = expectedMoveForView(view);
  const candidates = recipes.filter(
    (recipe) => expectedMove === null || recipe.expectedMove === expectedMove,
  );
  return (
    candidates.find((recipe) => recipe.ivRegime === ivRegime) ??
    candidates.find((recipe) => recipe.ivRegime === "any") ??
    null
  );
}
