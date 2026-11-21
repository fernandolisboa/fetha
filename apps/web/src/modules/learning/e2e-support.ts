import { getLesson } from "./catalog";

export interface LessonQuizAnswerForE2E {
  questionId: string;
  correctOptionId: string;
  correctOptionText: string;
}

// E2E-only: `learning.spec.ts` needs the lesson's correct answers to drive
// the quiz form through the UI without hardcoding them in the spec, where a
// content edit would silently break the test. Exported from `index.ts`
// instead of the catalog itself, so an E2E route never gets a reason to read
// anything else out of the module's internals.
export function getLessonQuizAnswersForE2E(lessonId: string): LessonQuizAnswerForE2E[] | null {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;

  return lesson.quiz.map((question) => {
    const correctOption = question.options.find((option) => option.id === question.correctOptionId);
    return {
      questionId: question.id,
      correctOptionId: question.correctOptionId,
      correctOptionText: correctOption?.text.pt ?? "",
    };
  });
}
