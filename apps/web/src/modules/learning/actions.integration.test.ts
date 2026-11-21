import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.REGISTRATION_MODE = "open";

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(currentHeaders) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { openVerificationLink } from "@/modules/auth/registration-test-support";
import { signUp } from "@/modules/auth/service";
import { testRequestHeaders, uniqueTestIp } from "@/modules/auth/test-support";

import { submitLessonQuizAction } from "./actions";
import { getLesson } from "./catalog";
import { LessonProgressRepository } from "./lesson-progress-repository";

const lesson = getLesson("what-is-an-option");
if (!lesson) throw new Error("fixture lesson missing");

const correctAnswers = (): { questionId: string; optionId: string }[] =>
  lesson.quiz.map((question) => ({
    questionId: question.id,
    optionId: question.correctOptionId,
  }));

const createdEmails: string[] = [];

function uniqueEmail(label: string): string {
  return `fetha-learning-actions-${label}-${crypto.randomUUID()}@example.com`;
}

async function signUpAndVerify(label: string): Promise<{ email: string; sessionHeaders: Headers }> {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  const outcome = await signUp(
    { name: label, email, termsAccepted: true, privacyAccepted: true },
    testRequestHeaders(uniqueTestIp()),
  );
  if (outcome.status !== "ok") {
    throw new Error(`sign-up failed for ${email}: ${outcome.status}`);
  }
  const sessionHeaders = await openVerificationLink(email);
  return { email, sessionHeaders };
}

async function signInUser(email: string): Promise<{ id: string }> {
  const { user } = await import("@/modules/auth/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) {
    throw new Error(`no user found for ${email}`);
  }
  return row;
}

beforeEach(() => {
  currentHeaders = new Headers();
});

afterEach(async () => {
  vi.restoreAllMocks();
  currentHeaders = new Headers();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("submitLessonQuizAction", () => {
  it("grades a perfect run as passed and records it against that user alone", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("ok");
    currentHeaders = sessionHeaders;

    const result = await submitLessonQuizAction({
      lessonId: lesson.id,
      answers: correctAnswers(),
    });
    expect(result).toMatchObject({ status: "ok", correct: lesson.quiz.length, passed: true });

    const user = await signInUser(email);
    const rows = await new LessonProgressRepository(getDb(), user).findAll();
    expect(rows).toEqual([
      {
        lessonId: lesson.id,
        lessonVersion: lesson.version,
        bestCorrect: lesson.quiz.length,
        total: lesson.quiz.length,
        passed: true,
      },
    ]);
  });

  it("returns not_found for an unknown lesson id", async () => {
    const { sessionHeaders } = await signUpAndVerify("not-found");
    currentHeaders = sessionHeaders;

    const result = await submitLessonQuizAction({
      lessonId: "not-a-real-lesson",
      answers: correctAnswers(),
    });
    expect(result).toEqual({ status: "error", error: "not_found" });
  });

  it("returns invalid when an answer names a question id foreign to the lesson", async () => {
    const { sessionHeaders } = await signUpAndVerify("foreign-question");
    currentHeaders = sessionHeaders;

    const answers = correctAnswers();
    answers[0] = { questionId: "not-a-real-question-id", optionId: "a" };

    const result = await submitLessonQuizAction({ lessonId: lesson.id, answers });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("returns invalid when an answer is missing for one of the lesson's questions", async () => {
    const { sessionHeaders } = await signUpAndVerify("missing-question");
    currentHeaders = sessionHeaders;

    const result = await submitLessonQuizAction({
      lessonId: lesson.id,
      answers: correctAnswers().slice(1),
    });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("returns invalid on a malformed payload", async () => {
    const { sessionHeaders } = await signUpAndVerify("malformed");
    currentHeaders = sessionHeaders;

    const result = await submitLessonQuizAction({
      lessonId: lesson.id,
      answers: [{ questionId: "", optionId: "" }],
    });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("rate limits after 20 submissions in the window, the 21st returns rate_limited", async () => {
    const { sessionHeaders } = await signUpAndVerify("rate-limit");
    currentHeaders = sessionHeaders;

    const outcomes = [];
    for (let i = 0; i < 21; i += 1) {
      outcomes.push(
        await submitLessonQuizAction({ lessonId: lesson.id, answers: correctAnswers() }),
      );
    }
    expect(outcomes.slice(0, 20).every((outcome) => outcome.status === "ok")).toBe(true);
    expect(outcomes[20]).toEqual({ status: "error", error: "rate_limited" });
  });
});
