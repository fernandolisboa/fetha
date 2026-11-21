"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import type { GradeResult } from "../grading";
import type { PublicQuizQuestion } from "../grading";
import { submitLessonQuizAction } from "../actions";
import { t } from "../strings";

export function QuizForm({
  lessonId,
  questions,
  nextLessonId,
}: {
  lessonId: string;
  questions: PublicQuizQuestion[];
  nextLessonId: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = questions.every((question) => answers[question.id] !== undefined);

  async function handleSubmit() {
    setError(null);
    if (!allAnswered) {
      setError(t.quiz.answerEvery);
      return;
    }
    setSubmitting(true);
    try {
      const response = await submitLessonQuizAction({
        lessonId,
        answers: questions.map((question) => ({
          questionId: question.id,
          optionId: answers[question.id] ?? "",
        })),
      });
      if (response.status === "error") {
        setError(response.error === "rate_limited" ? t.quiz.rateLimited : t.quiz.error);
        return;
      }
      setResult(response);
    } finally {
      setSubmitting(false);
    }
  }

  const gradedByQuestion = new Map(result?.questions.map((q) => [q.questionId, q]) ?? []);

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-[15px] font-semibold">{t.quiz.title}</h2>

      {questions.map((question, index) => {
        const graded = gradedByQuestion.get(question.id);
        return (
          <fieldset key={question.id} className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium">
              {index + 1}. {question.prompt}
            </legend>
            <RadioGroup
              value={answers[question.id] ?? null}
              onValueChange={(value: unknown) => {
                if (result || typeof value !== "string") return;
                setAnswers((prev) => ({ ...prev, [question.id]: value }));
              }}
              disabled={result !== null}
              className="flex flex-col gap-1.5"
            >
              {question.options.map((option) => {
                const isCorrect = graded && option.id === graded.correctOptionId;
                const isChosenWrong =
                  graded && !graded.correct && option.id === answers[question.id];
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius)] px-2 py-1.5 text-[13px]",
                      isCorrect && "text-up",
                      isChosenWrong && "text-down",
                    )}
                  >
                    <RadioGroupItem value={option.id} />
                    {option.text}
                  </label>
                );
              })}
            </RadioGroup>
            {graded ? (
              <p className={cn("text-[12px]", graded.correct ? "text-up" : "text-down")}>
                {graded.correct ? t.quiz.correct : t.quiz.incorrect}: {graded.explanation}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      {error ? <p className="text-down text-[13px]">{error}</p> : null}

      {!result ? (
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="self-start"
        >
          {submitting ? t.quiz.submitting : t.quiz.submit}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[13px] tabular-nums">
            {t.quiz.score(result.correct, result.total)}
          </p>
          <p className={cn("text-[13px]", result.passed ? "text-up" : "text-down")}>
            {result.passed ? t.quiz.passed : t.quiz.failed}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setResult(null);
                setAnswers({});
                setError(null);
              }}
            >
              {t.quiz.retry}
            </Button>
            {result.passed && nextLessonId ? (
              <Link href={`/aprender/${nextLessonId}`} className={buttonVariants({})}>
                {t.quiz.nextLesson}
              </Link>
            ) : null}
            <Link href="/aprender" className={buttonVariants({ variant: "outline" })}>
              {t.quiz.backToLessons}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
