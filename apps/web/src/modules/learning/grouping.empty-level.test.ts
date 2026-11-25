import { describe, expect, it, vi } from "vitest";
import type { Lesson } from "@fetha/contracts";

import type { PlacedLesson } from "./catalog";

const STUB_LESSON: Lesson = {
  id: "stub-lesson",
  version: 1,
  minutes: 1,
  title: { en: "Stub", pt: "Stub" },
  summary: { en: "Stub", pt: "Stub" },
  blocks: [{ type: "paragraph", text: { en: "Stub.", pt: "Stub." } }],
  quiz: [
    {
      id: "q1",
      prompt: { en: "Stub?", pt: "Stub?" },
      options: [
        { id: "a", text: { en: "Yes", pt: "Sim" } },
        { id: "b", text: { en: "No", pt: "Não" } },
      ],
      correctOptionId: "a",
      explanation: { en: "Stub.", pt: "Stub." },
    },
  ],
};

const STUB_PLACED: PlacedLesson = {
  ...STUB_LESSON,
  level: "first-steps",
  topic: "options-basics",
};

// `jornadaGroups` lists every level in `lessonCatalog.levels`, even one with
// no lessons placed in it, so the screen can render "Em breve" for it
// (ADR-0081). Catalog content today always fills every level, so this is
// exercised against a stubbed, synthetic catalog rather than the real one.
vi.mock("./catalog", () => ({
  lessonCatalog: {
    levels: [
      {
        id: "first-steps",
        title: { en: "First steps", pt: "Primeiros passos" },
        description: { en: "", pt: "" },
      },
      {
        id: "intermediate",
        title: { en: "Intermediate", pt: "Intermediário" },
        description: { en: "", pt: "" },
      },
      {
        id: "advanced",
        title: { en: "Advanced", pt: "Avançado" },
        description: { en: "", pt: "" },
      },
    ],
    topics: [],
    lessons: [{ id: STUB_PLACED.id, level: STUB_PLACED.level, topic: STUB_PLACED.topic }],
  },
  jornadaOrder: () => [STUB_PLACED],
}));

describe("jornadaGroups with a level that has no lessons", () => {
  it("still lists the empty level, with an empty lessons array", async () => {
    const { jornadaGroups } = await import("./grouping");
    const groups = jornadaGroups(new Map(), "pt");
    expect(groups.map((group) => group.level)).toEqual(["first-steps", "intermediate", "advanced"]);
    const intermediate = groups.find((group) => group.level === "intermediate");
    const advanced = groups.find((group) => group.level === "advanced");
    expect(intermediate?.lessons).toEqual([]);
    expect(advanced?.lessons).toEqual([]);
    const firstSteps = groups.find((group) => group.level === "first-steps");
    expect(firstSteps?.lessons.map((row) => row.lesson.id)).toEqual([STUB_PLACED.id]);
  });
});
