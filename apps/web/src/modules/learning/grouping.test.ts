import { describe, expect, it } from "vitest";

import { jornadaOrder, lessonCatalog } from "./catalog";
import {
  jornadaGroups,
  levelProgress,
  nextLesson,
  temasGroups,
  type ProgressByLessonId,
} from "./grouping";

function emptyProgress(): ProgressByLessonId {
  return new Map();
}

describe("jornadaGroups", () => {
  it("lists every level in the catalog's display order", () => {
    const groups = jornadaGroups(emptyProgress(), "pt");
    expect(groups.map((group) => group.level)).toEqual(lessonCatalog.levels.map((l) => l.id));
  });

  it("shows a level with no lessons as empty, not omitted", () => {
    const groups = jornadaGroups(emptyProgress(), "pt");
    const advanced = groups.find((group) => group.level === "advanced");
    expect(advanced).toBeDefined();
    expect(advanced?.lessons).toEqual([]);
  });

  it("puts every first-steps lesson in its own group, in catalog order", () => {
    const groups = jornadaGroups(emptyProgress(), "pt");
    const firstSteps = groups.find((group) => group.level === "first-steps");
    const expectedIds = jornadaOrder()
      .filter((lesson) => lesson.level === "first-steps")
      .map((lesson) => lesson.id);
    expect(firstSteps?.lessons.map((row) => row.lesson.id)).toEqual(expectedIds);
  });
});

describe("temasGroups", () => {
  it("lists every topic in the catalog's display order", () => {
    const groups = temasGroups(emptyProgress(), "pt");
    expect(groups.map((group) => group.topic)).toEqual(lessonCatalog.topics.map((t) => t.id));
  });

  it("regroups the same lessons as Jornada, just by topic", () => {
    const jornadaLessonIds = jornadaGroups(emptyProgress(), "pt")
      .flatMap((group) => group.lessons)
      .map((row) => row.lesson.id)
      .sort();
    const temasLessonIds = temasGroups(emptyProgress(), "pt")
      .flatMap((group) => group.lessons)
      .map((row) => row.lesson.id)
      .sort();
    expect(temasLessonIds).toEqual(jornadaLessonIds);
  });
});

describe("nextLesson", () => {
  it("recommends the first lesson in Jornada order when nothing is done", () => {
    const first = jornadaOrder()[0];
    expect(nextLesson(emptyProgress())?.id).toBe(first?.id);
  });

  it("recommends the first not-done lesson, skipping done ones in order", () => {
    const order = jornadaOrder();
    const firstLesson = order[0];
    if (!firstLesson) throw new Error("fixture catalog is empty");
    const progress: ProgressByLessonId = new Map([
      [firstLesson.id, { done: true, bestScore: { correct: 3, total: 4 } }],
    ]);
    expect(nextLesson(progress)?.id).toBe(order[1]?.id);
  });

  it("returns null once every lesson is done", () => {
    const progress: ProgressByLessonId = new Map(
      jornadaOrder().map((lesson) => [
        lesson.id,
        { done: true, bestScore: { correct: 1, total: 1 } },
      ]),
    );
    expect(nextLesson(progress)).toBeNull();
  });
});

describe("levelProgress", () => {
  it("counts done lessons out of the level's total", () => {
    const order = jornadaOrder().filter((lesson) => lesson.level === "first-steps");
    const firstLesson = order[0];
    if (!firstLesson) throw new Error("fixture catalog is empty");
    const progress: ProgressByLessonId = new Map([
      [firstLesson.id, { done: true, bestScore: { correct: 3, total: 4 } }],
    ]);
    const result = levelProgress("first-steps", progress);
    expect(result).toEqual({ done: 1, total: order.length });
  });

  it("reports zero of zero for a level with no lessons", () => {
    expect(levelProgress("advanced", emptyProgress())).toEqual({ done: 0, total: 0 });
  });
});
