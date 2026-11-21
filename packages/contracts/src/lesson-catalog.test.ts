import { describe, expect, it } from "vitest";

import {
  lessonCatalogSchema,
  lessonSchema,
  quizQuestionSchema,
  type Lesson,
} from "./lesson-catalog";

const localized = { en: "english text", pt: "texto em português" };

function makeQuestion(overrides: Partial<Parameters<typeof quizQuestionSchema.parse>[0]> = {}) {
  return {
    id: "q1",
    prompt: localized,
    options: [
      { id: "a", text: localized },
      { id: "b", text: localized },
    ],
    correctOptionId: "a",
    explanation: localized,
    ...overrides,
  };
}

function makeLesson(overrides: Partial<Lesson> = {}): unknown {
  return {
    id: "what-is-an-option",
    version: 1,
    minutes: 4,
    title: localized,
    summary: localized,
    blocks: [{ type: "paragraph", text: localized }],
    quiz: [
      makeQuestion(),
      makeQuestion({ id: "q2" }),
      makeQuestion({ id: "q3" }),
      makeQuestion({ id: "q4" }),
    ],
    ...overrides,
  };
}

describe("quizQuestionSchema", () => {
  it("accepts a question whose correctOptionId names one of its options", () => {
    expect(quizQuestionSchema.parse(makeQuestion())).toBeDefined();
  });

  it("rejects a correctOptionId that names no option", () => {
    expect(() => quizQuestionSchema.parse(makeQuestion({ correctOptionId: "z" }))).toThrow();
  });

  it("rejects duplicate option ids", () => {
    expect(() =>
      quizQuestionSchema.parse(
        makeQuestion({
          options: [
            { id: "a", text: localized },
            { id: "a", text: localized },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe("lessonSchema", () => {
  it("accepts a well-formed lesson", () => {
    expect(lessonSchema.parse(makeLesson())).toBeDefined();
  });

  it("rejects an unknown field such as a stray level or topic", () => {
    expect(() => lessonSchema.parse(makeLesson({ level: "first-steps" } as never))).toThrow();
  });

  it("rejects a quiz with fewer than 4 questions", () => {
    const quiz = [makeQuestion(), makeQuestion({ id: "q2" }), makeQuestion({ id: "q3" })];
    expect(() => lessonSchema.parse(makeLesson({ quiz }))).toThrow();
  });

  it("rejects a quiz with more than 5 questions", () => {
    const quiz = Array.from({ length: 6 }, (_, i) => makeQuestion({ id: `q${String(i)}` }));
    expect(() => lessonSchema.parse(makeLesson({ quiz }))).toThrow();
  });

  it("rejects duplicate question ids within the same quiz", () => {
    const quiz = [
      makeQuestion({ id: "q1" }),
      makeQuestion({ id: "q1" }),
      makeQuestion({ id: "q2" }),
      makeQuestion({ id: "q3" }),
    ];
    expect(() => lessonSchema.parse(makeLesson({ quiz }))).toThrow();
  });

  it("no longer accepts a structures field: it ships in PR 2, not reserved here", () => {
    expect(() =>
      lessonSchema.parse(makeLesson({ structures: ["bull-call-spread"] } as never)),
    ).toThrow();
  });
});

function makeCatalog(overrides: Partial<Parameters<typeof lessonCatalogSchema.parse>[0]> = {}) {
  return {
    levels: [{ id: "first-steps", title: localized, description: localized }],
    topics: [{ id: "options-basics", title: localized }],
    lessons: [{ id: "what-is-an-option", level: "first-steps", topic: "options-basics" }],
    ...overrides,
  };
}

describe("lessonCatalogSchema", () => {
  it("accepts a well-formed catalog", () => {
    expect(lessonCatalogSchema.parse(makeCatalog())).toBeDefined();
  });

  it("rejects a lesson whose level is not one of the catalog's own levels", () => {
    expect(() =>
      lessonCatalogSchema.parse(
        makeCatalog({
          lessons: [{ id: "what-is-an-option", level: "advanced", topic: "options-basics" }],
        }),
      ),
    ).toThrow();
  });

  it("rejects a lesson whose topic is not one of the catalog's own topics", () => {
    expect(() =>
      lessonCatalogSchema.parse(
        makeCatalog({
          lessons: [{ id: "what-is-an-option", level: "first-steps", topic: "pricing" }],
        }),
      ),
    ).toThrow();
  });
});
