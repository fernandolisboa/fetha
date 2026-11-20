import { describe, expect, it } from "vitest";

import { recipes } from "@/modules/strategies";

import { recipeForView } from "./select-recipe";

describe("recipeForView", () => {
  it("picks the recipe whose expected move and current IV regime both match", () => {
    expect(recipeForView("up", "low", recipes)?.id).toBe("bull-call-spread-low-iv");
    expect(recipeForView("down", "high", recipes)?.id).toBe("bear-call-spread-high-iv");
    expect(recipeForView("sideways", "high", recipes)?.id).toBe("call-butterfly");
  });

  it("falls back to the other regime's recipe for the same move on normal (any) IV", () => {
    expect(recipeForView("up", "any", recipes)?.id).toBe("bull-call-spread-low-iv");
    expect(recipeForView("down", "any", recipes)?.id).toBe("bear-put-spread-low-iv");
  });

  it("falls back to the other regime's recipe when the view's own regime has none for that move", () => {
    // "fica de lado" only has high-IV recipes in the book; low IV still gets one.
    expect(recipeForView("sideways", "low", recipes)?.id).toBe("call-butterfly");
  });

  it("considers only sideways and big_move recipes for 'não sei', across both regimes", () => {
    expect(recipeForView("unsure", "high", recipes)?.id).toBe("call-butterfly");
    expect(recipeForView("unsure", "low", recipes)?.id).toBe("long-straddle-low-iv");
  });

  it("finds no recipe when the book has nothing for the combination", () => {
    const withoutLow = recipes.filter((recipe) => recipe.ivRegime !== "low");
    expect(recipeForView("up", "low", withoutLow)?.id).toBe("bull-put-spread-high-iv");
    expect(recipeForView("up", "low", [])).toBeNull();
  });
});
