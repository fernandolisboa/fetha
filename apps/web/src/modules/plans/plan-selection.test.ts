import { describe, expect, it } from "vitest";
import { tickerSchema } from "@fetha/contracts";

import { catalog, recipeById } from "@/modules/strategies";

import { legSelectionFor, PLAN_LOT } from "./plan-selection";

describe("legSelectionFor", () => {
  it("asks the engine for a monthly expiry at least 20 sessions ahead, by the recipe's strikes", () => {
    const recipe = recipeById("bull-call-spread-low-iv");
    const structure = catalog.find((entry) => entry.structure.id === "bull-call-spread")?.structure;
    if (!recipe || !structure) throw new Error("fixtures missing");

    const selection = legSelectionFor(recipe, structure, tickerSchema.parse("PETR4"), 2);

    expect(selection.expiry).toEqual({ kind: "business_days", min: 20, max: 50 });
    expect(selection.strikes).toEqual(recipe.definition.strikes);
    expect(selection.quantity).toBe(PLAN_LOT * 2);
    expect(selection.structure.id).toBe("bull-call-spread");
  });
});
