import type { Lesson, LevelId, TopicId } from "@fetha/contracts";

import { jornadaOrder, lessonCatalog } from "./catalog";

export interface LessonProgressStatus {
  done: boolean;
  bestScore: { correct: number; total: number } | null;
}

export type ProgressByLessonId = ReadonlyMap<string, LessonProgressStatus>;

export interface LessonRow {
  lesson: Lesson;
  status: LessonProgressStatus;
}

export interface LevelGroup {
  level: LevelId;
  title: string;
  description: string;
  lessons: LessonRow[];
}

export interface TopicGroup {
  topic: TopicId;
  title: string;
  lessons: LessonRow[];
}

const NO_PROGRESS: LessonProgressStatus = { done: false, bestScore: null };

function statusFor(lesson: Lesson, progress: ProgressByLessonId): LessonProgressStatus {
  return progress.get(lesson.id) ?? NO_PROGRESS;
}

// Jornada: the same lessons as Temas, regrouped by level in the catalog's
// own display order (ADR-0081). Levels with no lessons still show, so the
// screen can render "Em breve" for them.
export function jornadaGroups(progress: ProgressByLessonId, locale: "en" | "pt"): LevelGroup[] {
  const ordered = jornadaOrder();
  return lessonCatalog.levels.map((level) => ({
    level: level.id,
    title: level.title[locale],
    description: level.description[locale],
    lessons: ordered
      .filter((lesson) => lesson.level === level.id)
      .map((lesson) => ({ lesson, status: statusFor(lesson, progress) })),
  }));
}

// Temas: the same lessons, regrouped by topic; within a topic they keep
// Jornada's order (by level, then catalog position) rather than a second,
// independently maintained order.
export function temasGroups(progress: ProgressByLessonId, locale: "en" | "pt"): TopicGroup[] {
  const ordered = jornadaOrder();
  return lessonCatalog.topics.map((topic) => ({
    topic: topic.id,
    title: topic.title[locale],
    lessons: ordered
      .filter((lesson) => lesson.topic === topic.id)
      .map((lesson) => ({ lesson, status: statusFor(lesson, progress) })),
  }));
}

// The recommended next lesson: the first lesson not done, in Jornada order.
// `null` once every lesson is done.
export function nextLesson(progress: ProgressByLessonId): Lesson | null {
  return jornadaOrder().find((lesson) => !statusFor(lesson, progress).done) ?? null;
}

export function levelProgress(
  level: LevelId,
  progress: ProgressByLessonId,
): { done: number; total: number } {
  const lessonsInLevel = jornadaOrder().filter((lesson) => lesson.level === level);
  const done = lessonsInLevel.filter((lesson) => statusFor(lesson, progress).done).length;
  return { done, total: lessonsInLevel.length };
}
