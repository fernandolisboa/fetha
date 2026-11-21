import { beforeAll, describe, expect, it } from "vitest";

import { getLesson } from "./catalog";
import { answersMatchLessonQuestions, gradeQuiz, publicQuiz } from "./grading";
import { loadIllustrativeExamples, type IllustrativeExamples } from "./illustrative-market";

const lesson = getLesson("what-is-an-option");
if (!lesson) throw new Error("fixture lesson missing");

let examples: IllustrativeExamples;

beforeAll(async () => {
  examples = await loadIllustrativeExamples();
});

describe("publicQuiz", () => {
  it("never includes the correct option id key or the explanation", () => {
    const quiz = publicQuiz(lesson, "pt", examples);
    for (const question of quiz) {
      expect(question).not.toHaveProperty("correctOptionId");
      for (const option of question.options) {
        expect(option).not.toHaveProperty("correctOptionId");
      }
    }
    const serialized = JSON.stringify(quiz);
    for (const question of lesson.quiz) {
      expect(serialized).not.toContain(question.explanation.pt);
    }
  });

  it("keeps every question's options in the lesson's own order", () => {
    const quiz = publicQuiz(lesson, "pt", examples);
    expect(quiz.map((q) => q.options.map((o) => o.id))).toEqual(
      lesson.quiz.map((q) => q.options.map((o) => o.id)),
    );
  });

  it("never leaves a raw {{placeholder}} token in a resolved prompt or option", () => {
    const quiz = publicQuiz(lesson, "pt", examples);
    expect(JSON.stringify(quiz)).not.toContain("{{");
  });
});

describe("gradeQuiz", () => {
  it("grades a perfect run as passed with every question correct", () => {
    const answers = lesson.quiz.map((question) => ({
      questionId: question.id,
      optionId: question.correctOptionId,
    }));
    const result = gradeQuiz(lesson, answers, "pt", examples);
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
    const result = gradeQuiz(lesson, answers, "pt", examples);
    expect(result.passed).toBe(false);
    expect(result.correct).toBe(1);
  });

  it("treats a missing answer for a question as incorrect, not a crash", () => {
    const result = gradeQuiz(lesson, [], "pt", examples);
    expect(result.correct).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.questions).toHaveLength(lesson.quiz.length);
  });
});

describe("answersMatchLessonQuestions", () => {
  it("accepts exactly the lesson's own question ids, in any order", () => {
    const answers = [...lesson.quiz]
      .reverse()
      .map((question) => ({ questionId: question.id, optionId: question.correctOptionId }));
    expect(answersMatchLessonQuestions(lesson, answers)).toBe(true);
  });

  it("rejects a missing question id", () => {
    const answers = lesson.quiz
      .slice(1)
      .map((question) => ({ questionId: question.id, optionId: question.correctOptionId }));
    expect(answersMatchLessonQuestions(lesson, answers)).toBe(false);
  });

  it("rejects a foreign question id from another lesson", () => {
    const answers = lesson.quiz.map((question) => ({
      questionId: question.id,
      optionId: question.correctOptionId,
    }));
    answers[0] = { questionId: "not-a-real-question-id", optionId: "a" };
    expect(answersMatchLessonQuestions(lesson, answers)).toBe(false);
  });

  it("rejects a duplicated question id", () => {
    const answers = lesson.quiz.map((question) => ({
      questionId: lesson.quiz[0]?.id ?? question.id,
      optionId: question.correctOptionId,
    }));
    expect(answersMatchLessonQuestions(lesson, answers)).toBe(false);
  });
});
