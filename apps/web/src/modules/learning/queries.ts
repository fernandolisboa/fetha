import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { getLesson, jornadaOrder, type PlacedLesson } from "./catalog";
import {
  jornadaGroups,
  nextLesson,
  temasGroups,
  type LevelGroup,
  type ProgressByLessonId,
  type TopicGroup,
} from "./grouping";
import { loadIllustrativeExamples, type IllustrativeExamples } from "./illustrative-market";
import { LessonProgressRepository } from "./lesson-progress-repository";
import { toProgressMap } from "./progress";

export interface LessonsOverview {
  progress: ProgressByLessonId;
  jornadaGroups: LevelGroup[];
  temasGroups: TopicGroup[];
  recommended: PlacedLesson | null;
}

// The one read model `/aprender` renders from: both views regroup the same
// lessons, so one query assembles both rather than each page wiring the
// catalog, the progress repository and the grouping module back together.
export const getMyLessonsOverview = cache(async (): Promise<LessonsOverview> => {
  const order = jornadaOrder();
  const repository = await forCurrentUser(getDb(), LessonProgressRepository);
  const rows = await repository.findAll();
  const progress = toProgressMap(rows, order);

  return {
    progress,
    jornadaGroups: jornadaGroups(progress, "pt"),
    temasGroups: temasGroups(progress, "pt"),
    recommended: nextLesson(progress),
  };
});

export interface LessonPage {
  lesson: PlacedLesson;
  examples: IllustrativeExamples;
  progress: ProgressByLessonId;
  position: number;
  totalLessons: number;
  nextLessonId: string | null;
  levelGroup: LevelGroup | undefined;
}

// The one read model `/aprender/[lesson]` renders from.
export const getMyLessonPage = cache(async (id: string): Promise<LessonPage | null> => {
  const lessonContent = getLesson(id);
  if (!lessonContent) return null;

  const order = jornadaOrder();
  const position = order.findIndex((candidate) => candidate.id === id);
  const lesson = order[position];
  if (!lesson || position < 0) return null;

  const [repository, examples] = await Promise.all([
    forCurrentUser(getDb(), LessonProgressRepository),
    loadIllustrativeExamples(),
  ]);
  const rows = await repository.findAll();
  const progress = toProgressMap(rows, order);

  return {
    lesson,
    examples,
    progress,
    position,
    totalLessons: order.length,
    nextLessonId: order[position + 1]?.id ?? null,
    levelGroup: jornadaGroups(progress, "pt").find((group) => group.level === lesson.level),
  };
});
