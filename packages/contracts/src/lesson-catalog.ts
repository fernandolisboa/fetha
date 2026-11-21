import { z } from "zod";

// Learning tracks are one catalog of lessons, each carrying a level and a
// topic; the lessons screen regroups the same lessons by either axis
// (docs/adr/0081). `topic` names the subject of a lesson, never the visual
// theme (`preferences.theme`, ADR-0015/0069).

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
  // References an illustrative pricing example by id (illustrative-market.ts);
  // the page resolves it into a PayoffChart + StatBlocks pair, never into text.
  z.strictObject({
    type: z.literal("payoff-example"),
    exampleId: z.string().min(1),
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

export const MIN_QUIZ_QUESTIONS = 3;
export const MAX_QUIZ_QUESTIONS = 5;
export const PASSING_SCORE_RATIO = 0.75;

export const lessonSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  version: z.number().int().positive(),
  level: levelIdSchema,
  topic: topicIdSchema,
  // Reserved for PR 2's "Estruturas" view (one lesson per option structure);
  // left optional now so the format does not need to change to add it.
  structures: z.array(z.string().min(1)).optional(),
  minutes: z.number().int().positive().max(30),
  title: localizedTextSchema,
  summary: localizedTextSchema,
  blocks: z.array(lessonBlockSchema).min(1),
  quiz: z.array(quizQuestionSchema).min(MIN_QUIZ_QUESTIONS).max(MAX_QUIZ_QUESTIONS),
});
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
export const lessonCatalogSchema = z.strictObject({
  levels: z.array(levelCatalogEntrySchema).min(1),
  topics: z.array(topicCatalogEntrySchema).min(1),
  lessons: z.array(catalogLessonEntrySchema).min(1),
});
export type LessonCatalog = z.infer<typeof lessonCatalogSchema>;
