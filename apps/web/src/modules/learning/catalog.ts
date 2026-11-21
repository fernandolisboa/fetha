import {
  lessonCatalogSchema,
  lessonSchema,
  type Lesson,
  type LessonCatalog,
  type LevelId,
  type TopicId,
} from "@fetha/contracts";

import buyingVsWriting from "./content/buying-vs-writing.json";
import callsAndPuts from "./content/calls-and-puts.json";
import catalogJson from "./content/catalog.json";
import exerciseOnB3 from "./content/exercise-on-b3.json";
import readingTheSeriesCode from "./content/reading-the-series-code.json";
import strikeExpiryPremium from "./content/strike-expiry-premium.json";
import whatIsAnOption from "./content/what-is-an-option.json";

// `catalog.json`'s `lessons` array fixes Jornada order; each entry's file is
// imported explicitly (rather than resolved dynamically by id) so a bundler
// includes every lesson and a missing file is a build error, not a 404.
const LESSON_FILES: readonly unknown[] = [
  whatIsAnOption,
  callsAndPuts,
  strikeExpiryPremium,
  buyingVsWriting,
  exerciseOnB3,
  readingTheSeriesCode,
];

export const lessonCatalog: LessonCatalog = lessonCatalogSchema.parse(catalogJson);

export const lessons: readonly Lesson[] = LESSON_FILES.map((file) => lessonSchema.parse(file));

const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

export function getLesson(id: string): Lesson | null {
  return lessonsById.get(id) ?? null;
}

// A lesson placed in the catalog: its own content plus the level and topic
// that `catalog.json`'s `lessons` entry (the only place those live,
// ADR-0081) assigns it.
export type PlacedLesson = Lesson & { level: LevelId; topic: TopicId };

// Jornada order: the catalog's own lesson listing, which is by level then by
// position within it (the content check pins this).
export function jornadaOrder(): readonly PlacedLesson[] {
  return lessonCatalog.lessons
    .map((entry) => {
      const lesson = lessonsById.get(entry.id);
      return lesson ? { ...lesson, level: entry.level, topic: entry.topic } : undefined;
    })
    .filter((placed): placed is PlacedLesson => placed !== undefined);
}
