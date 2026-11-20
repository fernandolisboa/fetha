import type { IvRegime, Recipe } from "@fetha/contracts";

import { movesForView, type PlanView } from "./view";

// The recipe to copy for a stated view and the session's current IV regime (ticket #379, round 1
// review item 2): among the recipes whose expected move the view admits (`movesForView`), the
// one whose own `ivRegime` matches today's exactly wins; today's regime is "any" for normal IV,
// or no recipe book entry claims that view's own regime, falls back to the first remaining
// candidate (the catalog's only other regime for that move — no recipe in the book is itself
// `ivRegime: "any"` today). Null when the view admits no recipe at all.
export function recipeForView(
  view: PlanView,
  ivRegime: IvRegime,
  recipes: readonly Recipe[],
): Recipe | null {
  const moves = movesForView(view);
  const candidates = recipes.filter((recipe) => moves.includes(recipe.expectedMove));
  if (candidates.length === 0) return null;
  return candidates.find((recipe) => recipe.ivRegime === ivRegime) ?? candidates[0] ?? null;
}
