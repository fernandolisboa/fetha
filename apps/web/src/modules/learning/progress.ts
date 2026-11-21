import type { Lesson } from "@fetha/contracts";

import type { LessonProgressRow } from "./lesson-progress-repository";
import type { LessonProgressStatus, ProgressByLessonId } from "./grouping";

// A row from a lesson whose quiz version moved on counts as not yet
// attempted for the *current* quiz: its score was never measured against
// today's questions.
export function toProgressMap(
  rows: readonly LessonProgressRow[],
  lessons: readonly Lesson[],
): ProgressByLessonId {
  const lessonVersionById = new Map(lessons.map((lesson) => [lesson.id, lesson.version]));
  const map = new Map<string, LessonProgressStatus>();

  for (const row of rows) {
    if (lessonVersionById.get(row.lessonId) !== row.lessonVersion) continue;
    map.set(row.lessonId, {
      done: row.passed,
      bestScore: { correct: row.bestCorrect, total: row.total },
    });
  }

  return map;
}
