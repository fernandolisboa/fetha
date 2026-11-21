import { describe, expect, it } from "vitest";

import { getLesson } from "./catalog";
import { gradeQuiz, publicQuiz } from "./grading";

const lesson = getLesson("what-is-an-option");
if (!lesson) throw new Error("fixture lesson missing");

describe("publicQuiz", () => {
  it("never includes the correct option id or the explanation", () => {
    const quiz = publicQuiz(lesson, "pt");
    const serialized = JSON.stringify(quiz);
    for (const question of lesson.quiz) {
      expect(serialized).not.toContain(question.explanation.pt);
    }
  });

  it("keeps every question's options in the lesson's own order", () => {
    const quiz = publicQuiz(lesson, "pt");
    expect(quiz.map((q) => q.options.map((o) => o.id))).toEqual(
      lesson.quiz.map((q) => q.options.map((o) => o.id)),
    );
  });
});

describe("gradeQuiz", () => {
  it("grades a perfect run as passed with every question correct", () => {
    const answers = lesson.quiz.map((question) => ({
      questionId: question.id,
      optionId: question.correctOptionId,
    }));
    const result = gradeQuiz(lesson, answers, "pt");
    expect(result).toEqual({
      correct: lesson.quiz.length,
      total: lesson.quiz.length,
      passed: true,
      questions: lesson.quiz.map((question) => ({
        questionId: question.id,
        correct: true,
        correctOptionId: question.correctOptionId,
        explanation: question.explanation.pt,
      })),
    });
  });

  it("fails a run below the 75% passing bar", () => {
    const wrongOptionFor = (questionId: string) => {
      const question = lesson.quiz.find((q) => q.id === questionId);
      const wrong = question?.options.find((option) => option.id !== question.correctOptionId);
      return wrong?.id ?? "";
    };
    const answers = lesson.quiz.map((question, index) => ({
      questionId: question.id,
      optionId: index === 0 ? question.correctOptionId : wrongOptionFor(question.id),
    }));
    const result = gradeQuiz(lesson, answers, "pt");
    expect(result.passed).toBe(false);
    expect(result.correct).toBe(1);
  });

  it("treats a missing answer for a question as incorrect, not a crash", () => {
    const result = gradeQuiz(lesson, [], "pt");
    expect(result.correct).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.questions).toHaveLength(lesson.quiz.length);
  });
});
