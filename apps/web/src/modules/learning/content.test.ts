import { describe, expect, it } from "vitest";
import {
  levelIds,
  topicIds,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  type Lesson,
  type LessonBlock,
} from "@fetha/contracts";

import { lessonCatalog, lessons } from "./catalog";
import { loadIllustrativeExamples } from "./illustrative-market";
import { placeholderTokens, resolveText } from "./placeholders";

const localeKeys = ["en", "pt"] as const;

function blockTexts(block: LessonBlock): { en: string; pt: string }[] {
  if (block.type === "paragraph") return [block.text];
  if (block.type === "callout") return [block.text];
  if (block.type === "payoff-example") return [block.caption];
  return block.items.en.map((_, index) => ({
    en: block.items.en[index] ?? "",
    pt: block.items.pt[index] ?? "",
  }));
}

function allLocalizedTexts(lesson: Lesson): { en: string; pt: string }[] {
  const blockTextsFlat = lesson.blocks.flatMap(blockTexts);
  const quizTexts = lesson.quiz.flatMap((question) => [
    question.prompt,
    question.explanation,
    ...question.options.map((option) => option.text),
  ]);
  return [lesson.title, lesson.summary, ...blockTextsFlat, ...quizTexts];
}

describe("the lesson catalog and its content files", () => {
  it("lists exactly the lessons that have a content file, and vice versa", () => {
    const catalogIds = lessonCatalog.lessons.map((entry) => entry.id).sort();
    const fileIds = lessons.map((lesson) => lesson.id).sort();
    expect(fileIds).toEqual(catalogIds);
  });

  it("gives every lesson a unique id", () => {
    const ids = lessons.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references known levels and topics", () => {
    for (const lesson of lessons) {
      expect(levelIds).toContain(lesson.level);
      expect(topicIds).toContain(lesson.topic);
    }
    for (const entry of lessonCatalog.lessons) {
      expect(levelIds).toContain(entry.level);
      expect(topicIds).toContain(entry.topic);
    }
  });

  it("agrees with the catalog's own level and topic for every lesson", () => {
    const catalogById = new Map(lessonCatalog.lessons.map((entry) => [entry.id, entry]));
    for (const lesson of lessons) {
      const entry = catalogById.get(lesson.id);
      expect(entry).toBeDefined();
      expect(lesson.level).toBe(entry?.level);
      expect(lesson.topic).toBe(entry?.topic);
    }
  });

  it("carries both locales for every piece of text, each non-empty", () => {
    for (const lesson of lessons) {
      for (const text of allLocalizedTexts(lesson)) {
        for (const locale of localeKeys) {
          expect(text[locale].length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("uses the same placeholder tokens in English and in Portuguese", () => {
    for (const lesson of lessons) {
      for (const text of allLocalizedTexts(lesson)) {
        expect(placeholderTokens(text.pt).sort()).toEqual(placeholderTokens(text.en).sort());
      }
    }
  });

  it("every quiz has between 3 and 5 questions, each with an explanation", () => {
    for (const lesson of lessons) {
      expect(lesson.quiz.length).toBeGreaterThanOrEqual(MIN_QUIZ_QUESTIONS);
      expect(lesson.quiz.length).toBeLessThanOrEqual(MAX_QUIZ_QUESTIONS);
      for (const question of lesson.quiz) {
        expect(question.explanation.en.length).toBeGreaterThan(0);
        expect(question.explanation.pt.length).toBeGreaterThan(0);
        expect(question.options.some((option) => option.id === question.correctOptionId)).toBe(
          true,
        );
      }
    }
  });

  it("every placeholder in every lesson resolves against the illustrative market", async () => {
    const examples = await loadIllustrativeExamples();
    for (const lesson of lessons) {
      for (const text of allLocalizedTexts(lesson)) {
        expect(() => resolveText(text.pt, examples)).not.toThrow();
        expect(() => resolveText(text.en, examples)).not.toThrow();
      }
    }
  });

  it("pins every lesson's resolved pt-BR content, so drift in text or numbers fails the test", async () => {
    const examples = await loadIllustrativeExamples();
    for (const lesson of lessons) {
      const resolved = {
        title: lesson.title.pt,
        summary: lesson.summary.pt,
        blocks: lesson.blocks.map((block) => {
          if (block.type === "paragraph") {
            return { type: block.type, text: resolveText(block.text.pt, examples) };
          }
          if (block.type === "callout") {
            return {
              type: block.type,
              tone: block.tone,
              text: resolveText(block.text.pt, examples),
            };
          }
          if (block.type === "payoff-example") {
            return {
              type: block.type,
              exampleId: block.exampleId,
              caption: resolveText(block.caption.pt, examples),
            };
          }
          return {
            type: block.type,
            items: block.items.pt.map((item) => resolveText(item, examples)),
          };
        }),
        quiz: lesson.quiz.map((question) => ({
          prompt: resolveText(question.prompt.pt, examples),
          options: question.options.map((option) => resolveText(option.text.pt, examples)),
          correctOptionId: question.correctOptionId,
          explanation: resolveText(question.explanation.pt, examples),
        })),
      };
      expect(resolved).toMatchSnapshot(lesson.id);
    }
  });
});
