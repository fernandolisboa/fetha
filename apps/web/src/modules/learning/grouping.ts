import type { ExpectedMove, Lesson, LevelId, TopicId } from "@fetha/contracts";
import { expectedMoves } from "@fetha/contracts";

import { recipes } from "@/modules/strategies";

import { jornadaOrder, lessonCatalog, type PlacedLesson } from "./catalog";

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

export interface MarketViewGroup {
  view: ExpectedMove;
  title: string;
  lessons: LessonRow[];
}

const MARKET_VIEW_TITLES: Record<ExpectedMove, { en: string; pt: string }> = {
  up: { en: "Up", pt: "Alta" },
  down: { en: "Down", pt: "Baixa" },
  sideways: { en: "Sideways", pt: "Lateral" },
  big_move: { en: "A strong move", pt: "Movimento forte" },
};

// Each structure id has exactly one recipe in the catalog (a content test
// enforces it), so its own expected move is unambiguous.
function expectedMoveForStructure(structureId: string): ExpectedMove | null {
  return (
    recipes.find((recipe) => recipe.definition.structureId === structureId)?.expectedMove ?? null
  );
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

// Estruturas: one row per structure lesson, grouped by the market view its own recipe expects
// (`modules/strategies`' `recipes`), in `expectedMoves`' own order; within a view, lessons keep
// Jornada order. Lessons with no `structure` (every lesson outside PR 2's structures topic) never
// appear here.
export function estruturasGroups(
  progress: ProgressByLessonId,
  locale: "en" | "pt",
): MarketViewGroup[] {
  const ordered = jornadaOrder().filter((lesson) => lesson.structure !== undefined);
  return expectedMoves.map((view) => ({
    view,
    title: MARKET_VIEW_TITLES[view][locale],
    lessons: ordered
      .filter(
        (lesson) =>
          lesson.structure !== undefined && expectedMoveForStructure(lesson.structure) === view,
      )
      .map((lesson) => ({ lesson, status: statusFor(lesson, progress) })),
  }));
}

// The recommended next lesson: the first lesson not done, in Jornada order.
// `null` once every lesson is done.
export function nextLesson(progress: ProgressByLessonId): PlacedLesson | null {
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
