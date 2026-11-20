import { describe, expect, it } from "vitest";

import { recipes } from "@/modules/strategies";

import { recipeForView } from "./select-recipe";

describe("recipeForView", () => {
  it("picks the recipe whose expected move and current IV regime both match", () => {
    expect(recipeForView("up", "low", recipes)?.id).toBe("bull-call-spread-low-iv");
    expect(recipeForView("down", "high", recipes)?.id).toBe("bear-call-spread-high-iv");
    expect(recipeForView("sideways", "high", recipes)?.id).toBe("call-butterfly");
  });

  it("falls back to an 'any' regime recipe for the view when no exact regime matches", () => {
    expect(recipeForView("up", "any", recipes)).toBeNull();
  });

  it("matches by IV regime alone for 'não sei', across every expected move", () => {
    expect(recipeForView("unsure", "high", recipes)?.id).toBe("bull-put-spread-high-iv");
    expect(recipeForView("unsure", "low", recipes)?.id).toBe("bull-call-spread-low-iv");
  });

  it("finds no recipe when the book has nothing for the combination", () => {
    const withoutLow = recipes.filter((recipe) => recipe.ivRegime !== "low");
    expect(recipeForView("up", "low", withoutLow)).toBeNull();
  });
});
