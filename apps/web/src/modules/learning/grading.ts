import { PASSING_SCORE_RATIO, type Lesson } from "@fetha/contracts";

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

// What the quiz form receives before submit: question text and options only
// (CLAUDE.md edge-validation + "AI/engine never..." style invariant applied
// to grading: the client must not be able to compute pass/fail on its own).
export function publicQuiz(lesson: Lesson, locale: "en" | "pt"): PublicQuizQuestion[] {
  return lesson.quiz.map((question) => ({
    id: question.id,
    prompt: question.prompt[locale],
    options: question.options.map((option) => ({ id: option.id, text: option.text[locale] })),
  }));
}

// Grades server-side only: the caller (a Server Action) is the one place
// that ever sees `correctOptionId` and `explanation` before the client asks
// for them by submitting its answers.
export function gradeQuiz(lesson: Lesson, answers: QuizAnswer[], locale: "en" | "pt"): GradeResult {
  const answersByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.optionId]));

  const questions = lesson.quiz.map((question) => ({
    questionId: question.id,
    correct: answersByQuestion.get(question.id) === question.correctOptionId,
    correctOptionId: question.correctOptionId,
    explanation: question.explanation[locale],
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
