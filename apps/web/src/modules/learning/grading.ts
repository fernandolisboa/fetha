import { PASSING_SCORE_RATIO, type Lesson } from "@fetha/contracts";

import type { IllustrativeExamples } from "./illustrative-market";
import { resolveText } from "./placeholders";

export interface QuizAnswer {
  questionId: string;
  optionId: string;
}

export interface GradedQuestion {
  questionId: string;
  correct: boolean;
  correctOptionId: string;
  explanation: string;
}

export interface GradeResult {
  correct: number;
  total: number;
  passed: boolean;
  questions: GradedQuestion[];
}

export interface PublicQuizOption {
  id: string;
  text: string;
}

export interface PublicQuizQuestion {
  id: string;
  prompt: string;
  options: PublicQuizOption[];
}

// What the quiz form receives before submit: question text and options
// only, every placeholder already resolved (CLAUDE.md edge-validation +
// "AI/engine never..." style invariant applied to grading: the client must
// not be able to compute pass/fail on its own, and must never see a raw
// `{{token}}`).
export function publicQuiz(
  lesson: Lesson,
  locale: "en" | "pt",
  examples: IllustrativeExamples,
): PublicQuizQuestion[] {
  return lesson.quiz.map((question) => ({
    id: question.id,
    prompt: resolveText(question.prompt[locale], examples),
    options: question.options.map((option) => ({
      id: option.id,
      text: resolveText(option.text[locale], examples),
    })),
  }));
}

// Grades server-side only: the action that calls this is the only place
// that ever compares a submitted answer against `correctOptionId`, and the
// only place the resolved `explanation` reaches the client, which happens
// only after it has submitted its answers.
export function gradeQuiz(
  lesson: Lesson,
  answers: QuizAnswer[],
  locale: "en" | "pt",
  examples: IllustrativeExamples,
): GradeResult {
  const answersByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.optionId]));

  const questions = lesson.quiz.map((question) => ({
    questionId: question.id,
    correct: answersByQuestion.get(question.id) === question.correctOptionId,
    correctOptionId: question.correctOptionId,
    explanation: resolveText(question.explanation[locale], examples),
  }));

  const correct = questions.filter((question) => question.correct).length;
  const total = questions.length;

  return {
    correct,
    total,
    passed: correct / total >= PASSING_SCORE_RATIO,
    questions,
  };
}

// The submitted answers must name exactly the lesson's own question ids,
// no more and no fewer: a stale tab from a changed quiz, or a tampered
// request, must fail loudly instead of silently scoring against questions
// it never actually answered.
export function answersMatchLessonQuestions(lesson: Lesson, answers: QuizAnswer[]): boolean {
  const questionIds = new Set(lesson.quiz.map((question) => question.id));
  const answeredIds = new Set(answers.map((answer) => answer.questionId));
  if (answeredIds.size !== answers.length) return false;
  if (answeredIds.size !== questionIds.size) return false;
  for (const id of answeredIds) {
    if (!questionIds.has(id)) return false;
  }
  return true;
}
