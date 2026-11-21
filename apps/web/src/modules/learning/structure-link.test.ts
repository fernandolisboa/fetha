import { describe, expect, it } from "vitest";
import { structureIds } from "@fetha/contracts";

import { recipes } from "@/modules/strategies";

import { lessons } from "./catalog";
import { lessonHrefForStructure } from "./structure-link";

describe("structureIds", () => {
  it("matches exactly the structure ids recipes.json uses", () => {
    const usedByRecipes = new Set(recipes.map((recipe) => recipe.definition.structureId));
    expect(new Set(structureIds)).toEqual(usedByRecipes);
  });

  it("gives each structure id exactly one lesson", () => {
    const lessonsByStructure = lessons.flatMap((lesson) =>
      lesson.structure ? [lesson.structure] : [],
    );
    for (const structureId of structureIds) {
      const matches = lessonsByStructure.filter((id) => id === structureId);
      expect(
        matches.length,
        `structure "${structureId}" has ${String(matches.length)} lessons`,
      ).toBe(1);
    }
    expect(lessonsByStructure.length).toBe(structureIds.length);
  });
});

describe("lessonHrefForStructure", () => {
  it("links to the one lesson for every known structure", () => {
    for (const structureId of structureIds) {
      expect(lessonHrefForStructure(structureId)).toMatch(/^\/aprender\/[a-z0-9-]+$/);
    }
  });

  it("returns null for an unknown structure id", () => {
    expect(lessonHrefForStructure("not-a-structure")).toBeNull();
    expect(lessonHrefForStructure("collar")).toBeNull();
  });
});
