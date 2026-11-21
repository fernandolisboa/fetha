import { z } from "zod";

// Learning tracks are one catalog of lessons, each carrying a level and a
// topic; the lessons screen regroups the same lessons by either axis
// (docs/adr/0081, which amends ADR-0059's web-engine-consumer list). `topic`
// names the subject of a lesson, never the visual theme
// (`preferences.theme`, ADR-0015/0069).

export const levelIds = [
  "first-steps",
  "fundamentals",
  "beginner",
  "intermediate",
  "advanced",
] as const;
export const levelIdSchema = z.enum(levelIds);
export type LevelId = z.infer<typeof levelIdSchema>;

export const topicIds = [
  "options-basics",
  "pricing",
  "structures",
  "risk",
  "b3-rules",
  "using-fetha",
] as const;
export const topicIdSchema = z.enum(topicIds);
export type TopicId = z.infer<typeof topicIdSchema>;

// The illustrative, fictitious market every payoff-example block and every
// placeholder resolves against (`learning/illustrative-market.ts`): defined
// here, once, so a lesson's `payoff-example` block is validated against the
// same closed set `apps/web` prices, instead of an unchecked string plus a
// cast at the call site.
export const illustrativeExampleIds = [
  "long-call",
  "long-put",
  "short-call",
  "bull-call-spread",
  "bull-put-spread",
  "bear-call-spread",
  "bear-put-spread",
  "covered-call",
  "call-butterfly",
  "put-butterfly",
  "iron-condor",
  "long-straddle",
  "long-strangle",
] as const;
export const illustrativeExampleIdSchema = z.enum(illustrativeExampleIds);
export type IllustrativeExampleId = z.infer<typeof illustrativeExampleIdSchema>;

// The 12 structures the strategy catalog's own recipes use
// (`modules/strategies/recipes.json`), each with exactly one PR 2 lesson
// (a content test enforces it): the closed set a lesson's optional
// `structure` field, and every module's contextual "Aprender" link, names.
export const structureIds = [
  "long-call",
  "long-put",
  "bull-call-spread",
  "bull-put-spread",
  "bear-put-spread",
  "bear-call-spread",
  "covered-call",
  "call-butterfly",
  "put-butterfly",
  "iron-condor",
  "long-straddle",
  "long-strangle",
] as const;
export const structureIdSchema = z.enum(structureIds);
export type StructureId = z.infer<typeof structureIdSchema>;

// English is the source locale, pt-BR the shipped one (CLAUDE.md i18n rule);
// every lesson carries both so a content check can diff them.
export const localizedTextSchema = z.strictObject({
  en: z.string().min(1),
  pt: z.string().min(1),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

const localizedListSchema = z.strictObject({
  en: z.array(z.string().min(1)).min(1),
  pt: z.array(z.string().min(1)).min(1),
});

export const lessonBlockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), text: localizedTextSchema }),
  z.strictObject({ type: z.literal("list"), items: localizedListSchema }),
  z.strictObject({
    type: z.literal("callout"),
    tone: z.enum(["info", "warning"]).default("info"),
    text: localizedTextSchema,
  }),
  // The page resolves this into a PayoffChart + StatBlocks pair, never into text.
  z.strictObject({
    type: z.literal("payoff-example"),
    exampleId: illustrativeExampleIdSchema,
    caption: localizedTextSchema,
  }),
]);
export type LessonBlock = z.infer<typeof lessonBlockSchema>;

export const quizOptionSchema = z.strictObject({
  id: z.string().min(1),
  text: localizedTextSchema,
});
export type QuizOption = z.infer<typeof quizOptionSchema>;

export const quizQuestionSchema = z
  .strictObject({
    id: z.string().min(1),
    prompt: localizedTextSchema,
    options: z.array(quizOptionSchema).min(2).max(6),
    correctOptionId: z.string().min(1),
    explanation: localizedTextSchema,
  })
  .refine((question) => question.options.some((option) => option.id === question.correctOptionId), {
    message: "correctOptionId must name one of the question's options",
    path: ["correctOptionId"],
  })
  .refine(
    (question) =>
      new Set(question.options.map((option) => option.id)).size === question.options.length,
    { message: "option ids must be unique within a question", path: ["options"] },
  );
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

// A 3-question quiz needs 3 of 3 (100%) to clear the 75% passing bar, which
// defeats the point of a passing threshold at all; 4 is the smallest count
// where 75% (3 of 4) differs from a perfect run.
export const MIN_QUIZ_QUESTIONS = 4;
export const MAX_QUIZ_QUESTIONS = 5;
export const PASSING_SCORE_RATIO = 0.75;

// Level and topic are not repeated here: `catalog.json`'s own `lessons`
// entry is the one place a lesson's level and topic live (ADR-0081); a
// lesson file only ever carries its own content.
export const lessonSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    version: z.number().int().positive(),
    minutes: z.number().int().positive().max(30),
    title: localizedTextSchema,
    summary: localizedTextSchema,
    // The structure this lesson teaches, when it is one of PR 2's one-lesson-per-structure
    // lessons; absent for every other lesson. Closed to `structureIds` so a contextual link
    // elsewhere in the app can never point at an id no lesson claims.
    structure: structureIdSchema.optional(),
    blocks: z.array(lessonBlockSchema).min(1),
    quiz: z.array(quizQuestionSchema).min(MIN_QUIZ_QUESTIONS).max(MAX_QUIZ_QUESTIONS),
  })
  .refine(
    (lesson) => new Set(lesson.quiz.map((question) => question.id)).size === lesson.quiz.length,
    { message: "quiz question ids must be unique within a lesson", path: ["quiz"] },
  );
export type Lesson = z.infer<typeof lessonSchema>;

export const levelCatalogEntrySchema = z.strictObject({
  id: levelIdSchema,
  title: localizedTextSchema,
  description: localizedTextSchema,
});
export type LevelCatalogEntry = z.infer<typeof levelCatalogEntrySchema>;

export const topicCatalogEntrySchema = z.strictObject({
  id: topicIdSchema,
  title: localizedTextSchema,
});
export type TopicCatalogEntry = z.infer<typeof topicCatalogEntrySchema>;

export const catalogLessonEntrySchema = z.strictObject({
  id: z.string().min(1),
  level: levelIdSchema,
  topic: topicIdSchema,
});
export type CatalogLessonEntry = z.infer<typeof catalogLessonEntrySchema>;

// `catalog.json`'s `lessons` array fixes Jornada order (by level, then by
// position within the level); Temas order groups the same ids by topic at
// read time (`learning/grouping.ts`), never re-listed here.
export const lessonCatalogSchema = z
  .strictObject({
    levels: z.array(levelCatalogEntrySchema).min(1),
    topics: z.array(topicCatalogEntrySchema).min(1),
    lessons: z.array(catalogLessonEntrySchema).min(1),
  })
  .refine(
    (catalog) => {
      const knownLevels = new Set(catalog.levels.map((level) => level.id));
      return catalog.lessons.every((lesson) => knownLevels.has(lesson.level));
    },
    { message: "every lesson's level must be one of the catalog's own levels", path: ["lessons"] },
  )
  .refine(
    (catalog) => {
      const knownTopics = new Set(catalog.topics.map((topic) => topic.id));
      return catalog.lessons.every((lesson) => knownTopics.has(lesson.topic));
    },
    { message: "every lesson's topic must be one of the catalog's own topics", path: ["lessons"] },
  );
export type LessonCatalog = z.infer<typeof lessonCatalogSchema>;
