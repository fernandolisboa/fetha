"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import { getLesson } from "./catalog";
import { answersMatchLessonQuestions, gradeQuiz, type GradeResult } from "./grading";
import { loadIllustrativeExamples } from "./illustrative-market";
import { LessonProgressRepository } from "./lesson-progress-repository";

const SUBMIT_RATE_LIMIT = { windowSeconds: 10, max: 20 };

const answerSchema = z.strictObject({
  questionId: z.string().min(1),
  optionId: z.string().min(1),
});

const submitInputSchema = z.strictObject({
  lessonId: z.string().min(1),
  answers: z.array(answerSchema).min(1).max(5),
});

export type SubmitLessonQuizResult =
  | ({ status: "ok" } & GradeResult)
  | { status: "error"; error: "invalid" | "not_found" | "rate_limited" };

// Grades server-side (CLAUDE.md: the client never decides pass/fail). The
// client only ever sent question ids and option ids: `publicQuiz` is the one
// shape the quiz form renders from, and it carries no correct answer.
export async function submitLessonQuizAction(input: {
  lessonId: string;
  answers: { questionId: string; optionId: string }[];
}): Promise<SubmitLessonQuizResult> {
  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(getDb(), user.email, "learning/submit-quiz", SUBMIT_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }

  const parsed = submitInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  const lesson = getLesson(parsed.data.lessonId);
  if (!lesson) {
    return { status: "error", error: "not_found" };
  }
  if (!answersMatchLessonQuestions(lesson, parsed.data.answers)) {
    return { status: "error", error: "invalid" };
  }

  const examples = await loadIllustrativeExamples();
  const result = gradeQuiz(lesson, parsed.data.answers, "pt", examples);

  const repository = await forCurrentUser(getDb(), LessonProgressRepository);
  await repository.recordAttempt(
    lesson.id,
    lesson.version,
    result.correct,
    result.total,
    result.passed,
  );

  revalidatePath("/aprender");
  revalidatePath(`/aprender/${lesson.id}`);

  return { status: "ok", ...result };
}
