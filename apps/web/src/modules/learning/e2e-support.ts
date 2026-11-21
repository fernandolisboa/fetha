import { getLesson } from "./catalog";
import { publicQuiz } from "./grading";
import { loadIllustrativeExamples } from "./illustrative-market";

export interface LessonQuizAnswerForE2E {
  questionId: string;
  correctOptionId: string;
  correctOptionText: string;
}

// E2E-only: `learning.spec.ts` needs the lesson's correct answers to drive
// the quiz form through the UI without hardcoding them in the spec, where a
// content edit would silently break the test. Built from `publicQuiz`'s own
// resolved text (same placeholders the page itself renders), not from the
// raw lesson file, so a click-by-name in the spec finds the same label the
// page shows. Exported from `index.ts` instead of the catalog itself, so an
// E2E route never gets a reason to read anything else out of the module's
// internals.
export async function getLessonQuizAnswersForE2E(
  lessonId: string,
): Promise<LessonQuizAnswerForE2E[] | null> {
  const lesson = getLesson(lessonId);
  if (!lesson) return null;

  const examples = await loadIllustrativeExamples();
  const resolvedQuiz = publicQuiz(lesson, "pt", examples);
  const resolvedById = new Map(resolvedQuiz.map((question) => [question.id, question]));

  return lesson.quiz.map((question) => {
    const resolvedQuestion = resolvedById.get(question.id);
    const correctOption = resolvedQuestion?.options.find(
      (option) => option.id === question.correctOptionId,
    );
    return {
      questionId: question.id,
      correctOptionId: question.correctOptionId,
      correctOptionText: correctOption?.text ?? "",
    };
  });
}
