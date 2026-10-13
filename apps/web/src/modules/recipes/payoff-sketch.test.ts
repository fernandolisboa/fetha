import { describe, expect, it } from "vitest";
import { openUnitIntervalSchema, type Structure } from "@fetha/contracts";

import { catalog, recipes } from "@/modules/strategies";

import { payoffSketch } from "./payoff-sketch";

function structureOf(id: string): Structure {
  const entry = catalog.find((candidate) => candidate.structure.id === id);
  if (!entry) throw new Error(`no catalog entry ${id}`);
  return entry.structure;
}

function sketchFor(structureId: string) {
  const recipe = recipes.find((candidate) => candidate.definition.structureId === structureId);
  if (!recipe) throw new Error(`no recipe on ${structureId}`);
  return payoffSketch(structureOf(structureId), recipe.definition.strikes);
}

describe("payoffSketch", () => {
  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))(
    "%s: spans the unit box, has a gain and a loss side and averages zero",
    (_id, recipe) => {
      const points = payoffSketch(
        structureOf(recipe.definition.structureId),
        recipe.definition.strikes,
      );
      const ys = points.map((point) => point.y);

      expect(points[0]?.x).toBe(0);
      expect(points.at(-1)?.x).toBe(1);
      expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(1);
      expect(Math.max(...ys)).toBeGreaterThan(0);
      expect(Math.min(...ys)).toBeLessThan(0);
      expect(ys.reduce((sum, y) => sum + y, 0) / ys.length).toBeCloseTo(0);
    },
  );

  it("draws a bought call and a bull spread that never fall as the underlying rises", () => {
    for (const id of ["long-call", "bull-call-spread", "bull-put-spread"]) {
      const ys = sketchFor(id).map((point) => point.y);
      expect(ys.every((y, index) => index === 0 || y >= (ys[index - 1] ?? y) - 1e-12)).toBe(true);
    }
  });

  it("draws bear spreads and a bought put that never rise as the underlying rises", () => {
    for (const id of ["long-put", "bear-put-spread", "bear-call-spread"]) {
      const ys = sketchFor(id).map((point) => point.y);
      expect(ys.every((y, index) => index === 0 || y <= (ys[index - 1] ?? y) + 1e-12)).toBe(true);
    }
  });

  it("draws a straddle lowest at the money and a butterfly highest there", () => {
    const middle = 40;
    const straddle = sketchFor("long-straddle").map((point) => point.y);
    const butterfly = sketchFor("call-butterfly").map((point) => point.y);

    expect(Math.min(...straddle)).toBe(straddle[middle]);
    expect(Math.max(...butterfly)).toBe(butterfly[middle]);
  });

  it("spaces strikes by rank when a selection is not by moneyness", () => {
    const points = payoffSketch(structureOf("bull-call-spread"), [
      { kind: "delta", target: openUnitIntervalSchema.parse("0.5") },
      { kind: "delta", target: openUnitIntervalSchema.parse("0.3") },
    ]);

    expect(points).toHaveLength(81);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(1);
  });
});
