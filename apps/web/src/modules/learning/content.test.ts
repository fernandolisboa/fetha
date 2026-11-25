import { describe, expect, it } from "vitest";
import {
  levelIds,
  topicIds,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  PASSING_SCORE_RATIO,
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

  it("stores level and topic only in catalog.json, never duplicated on a lesson file", () => {
    for (const lesson of lessons) {
      expect(lesson).not.toHaveProperty("level");
      expect(lesson).not.toHaveProperty("topic");
    }
  });

  it("only references known levels and topics in the catalog", () => {
    for (const entry of lessonCatalog.lessons) {
      expect(levelIds).toContain(entry.level);
      expect(topicIds).toContain(entry.topic);
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

  it("every quiz has between 3 and 5 questions, each with an explanation and a unique id", () => {
    for (const lesson of lessons) {
      expect(lesson.quiz.length).toBeGreaterThanOrEqual(MIN_QUIZ_QUESTIONS);
      expect(lesson.quiz.length).toBeLessThanOrEqual(MAX_QUIZ_QUESTIONS);
      const ids = lesson.quiz.map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const question of lesson.quiz) {
        expect(question.explanation.en.length).toBeGreaterThan(0);
        expect(question.explanation.pt.length).toBeGreaterThan(0);
        expect(question.options.some((option) => option.id === question.correctOptionId)).toBe(
          true,
        );
      }
    }
  });

  it("never lets the correct option sit at the same position often enough to pass by always picking it", () => {
    for (const lesson of lessons) {
      const maxOptions = Math.max(...lesson.quiz.map((question) => question.options.length));
      for (let position = 0; position < maxOptions; position += 1) {
        const correctCount = lesson.quiz.filter(
          (question) => question.options[position]?.id === question.correctOptionId,
        ).length;
        const ratio = correctCount / lesson.quiz.length;
        expect(
          ratio,
          `lesson "${lesson.id}": always picking option position ${String(position)} scores ${String(ratio)}`,
        ).toBeLessThan(PASSING_SCORE_RATIO);
      }
    }
  });

  // `correctOptionId` itself reaches the DOM as each radio's `value`, so a visitor who never
  // looks at where an option is rendered could still pass by always picking the option whose id
  // is, say, "a" (review round 2, finding #9): the same check as the position one above, but
  // keyed on the id string rather than the array index.
  it("never lets the same option id be correct often enough to pass by always picking it", () => {
    for (const lesson of lessons) {
      const ids = new Set(lesson.quiz.flatMap((question) => question.options.map((o) => o.id)));
      for (const id of ids) {
        const correctCount = lesson.quiz.filter(
          (question) => question.correctOptionId === id,
        ).length;
        const ratio = correctCount / lesson.quiz.length;
        expect(
          ratio,
          `lesson "${lesson.id}": always picking option id "${id}" scores ${String(ratio)}`,
        ).toBeLessThan(PASSING_SCORE_RATIO);
      }
    }
  });

  // LessonBlocks, LessonGroupSection and the lesson page render a lesson's own title and summary
  // directly, with no call to resolveText (round 2 review, K6) — unlike every block and quiz
  // text, which the page does resolve. A placeholder token in a title or summary would render
  // as literal "{{...}}" text rather than failing a build, so this checks the raw, unresolved
  // strings rather than relying on the resolved-text checks below to catch it.
  it("never puts a {{placeholder}} token in a lesson's own title or summary", () => {
    for (const lesson of lessons) {
      for (const locale of localeKeys) {
        expect(placeholderTokens(lesson.title[locale])).toEqual([]);
        expect(placeholderTokens(lesson.summary[locale])).toEqual([]);
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

  it("never leaves a raw {{placeholder}} in resolved text, in either locale", async () => {
    const examples = await loadIllustrativeExamples();
    for (const lesson of lessons) {
      for (const text of allLocalizedTexts(lesson)) {
        expect(resolveText(text.pt, examples)).not.toContain("{{");
        expect(resolveText(text.en, examples)).not.toContain("{{");
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
