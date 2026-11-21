import { describe, expect, it } from "vitest";

import { lessons } from "./catalog";
import { getLessonQuizAnswersForE2E } from "./e2e-support";
import { publicQuiz } from "./grading";
import { loadIllustrativeExamples } from "./illustrative-market";

describe("getLessonQuizAnswersForE2E", () => {
  it("returns null for an unknown lesson id", async () => {
    expect(await getLessonQuizAnswersForE2E("not-a-real-lesson")).toBeNull();
  });

  it("every returned correctOptionText matches publicQuiz's own resolved option text", async () => {
    const examples = await loadIllustrativeExamples();
    for (const lesson of lessons) {
      const answers = await getLessonQuizAnswersForE2E(lesson.id);
      expect(answers).not.toBeNull();
      if (!answers) continue;

      const resolvedQuiz = publicQuiz(lesson, "pt", examples);
      const resolvedById = new Map(resolvedQuiz.map((question) => [question.id, question]));

      for (const answer of answers) {
        const resolvedQuestion = resolvedById.get(answer.questionId);
        const resolvedOption = resolvedQuestion?.options.find(
          (option) => option.id === answer.correctOptionId,
        );
        expect(resolvedOption).toBeDefined();
        expect(answer.correctOptionText).toBe(resolvedOption?.text);
        expect(answer.correctOptionText).not.toContain("{{");
      }
    }
  });
});
