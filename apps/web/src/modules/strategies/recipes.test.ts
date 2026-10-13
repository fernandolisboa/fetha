import { describe, expect, it } from "vitest";
import {
  checkStrategyCoherence,
  expectedMoves,
  recipeBookSchema,
  type Condition,
} from "@fetha/contracts";

import { catalog } from "./catalog";
import recipesJson from "./recipes.json";
import { recipeById, recipes } from "./recipes";

function ivRankComparators(condition: Condition): string[] {
  switch (condition.kind) {
    case "compare":
      return condition.left.kind === "indicator" && condition.left.indicator.kind === "iv_rank"
        ? [condition.comparator]
        : [];
    case "not":
      return ivRankComparators(condition.condition);
    case "and":
    case "or":
      return condition.conditions.flatMap(ivRankComparators);
  }
}

describe("the recipe file (#306)", () => {
  it("parses through the contracts schema", () => {
    expect(recipeBookSchema.safeParse(recipesJson).success).toBe(true);
  });

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))(
    "%s: its definition is coherent with its catalog structure and keeps the catalog defaults",
    (_id, recipe) => {
      const entry = catalog.find(
        (candidate) => candidate.structure.id === recipe.definition.structureId,
      );

      expect(entry).toBeDefined();
      if (!entry) return;
      expect(checkStrategyCoherence(recipe.definition, entry.structure)).toEqual({ ok: true });
      expect(recipe.definition.strikes).toEqual(entry.defaults.strikes);
      expect(recipe.definition.expiry).toEqual(entry.defaults.expiry);
      expect(recipe.definition.name).toBe(entry.structure.name);
    },
  );

  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))(
    "%s: its entry reads IV rank the way its IV regime says",
    (_id, recipe) => {
      const comparators = ivRankComparators(recipe.definition.entry);
      const expected = { low: ["<"], high: [">="], any: [] }[recipe.ivRegime];

      expect(comparators).toEqual(expected);
    },
  );

  it("never offers a structure with an unbounded max loss", () => {
    const unbounded = new Set(["short-straddle", "short-strangle"]);

    expect(recipes.filter((recipe) => unbounded.has(recipe.definition.structureId))).toEqual([]);
  });

  it("maps every expected move to the structures the issue's table names", () => {
    const structuresBy = Object.fromEntries(
      expectedMoves.map((move) => [
        move,
        recipes
          .filter((recipe) => recipe.expectedMove === move)
          .map((recipe) => `${recipe.definition.structureId}:${recipe.ivRegime}`),
      ]),
    );

    expect(structuresBy).toEqual({
      up: ["bull-call-spread:low", "long-call:low", "bull-put-spread:high", "covered-call:high"],
      down: ["bear-put-spread:low", "long-put:low", "bear-call-spread:high"],
      sideways: ["call-butterfly:any"],
      big_move: ["long-straddle:low", "long-strangle:low"],
    });
  });

  it("finds a recipe by id and nothing for an unknown one", () => {
    expect(recipeById("long-call-low-iv")?.definition.structureId).toBe("long-call");
    expect(recipeById("nope")).toBeNull();
  });
});
