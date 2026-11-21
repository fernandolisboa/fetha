import { describe, expect, it } from "vitest";

import { lessonSchema, quizQuestionSchema, type Lesson } from "./lesson-catalog";

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
    level: "first-steps",
    topic: "options-basics",
    minutes: 4,
    title: localized,
    summary: localized,
    blocks: [{ type: "paragraph", text: localized }],
    quiz: [makeQuestion(), makeQuestion({ id: "q2" }), makeQuestion({ id: "q3" })],
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

  it("rejects an unknown level", () => {
    expect(() => lessonSchema.parse(makeLesson({ level: "expert" as never }))).toThrow();
  });

  it("rejects a quiz with fewer than 3 questions", () => {
    expect(() => lessonSchema.parse(makeLesson({ quiz: [makeQuestion()] }))).toThrow();
  });

  it("rejects a quiz with more than 5 questions", () => {
    const quiz = Array.from({ length: 6 }, (_, i) => makeQuestion({ id: `q${String(i)}` }));
    expect(() => lessonSchema.parse(makeLesson({ quiz }))).toThrow();
  });

  it("accepts an optional structures field, reserved for the Estruturas view", () => {
    expect(lessonSchema.parse(makeLesson({ structures: ["bull-call-spread"] }))).toBeDefined();
  });
});
