import { structureIdSchema } from "@fetha/contracts";

import { lessons } from "./catalog";

// The one lesson per structure (ADR-0081 addendum) is found by its own `structure` field, never
// by assuming a lesson's id equals the structure id: a contextual link elsewhere in the app only
// ever calls this, so the mapping lives in one place.
const lessonIdByStructure = new Map(
  lessons.flatMap((lesson) => (lesson.structure ? [[lesson.structure, lesson.id] as const] : [])),
);

export function lessonHrefForStructure(structureId: string): string | null {
  const parsed = structureIdSchema.safeParse(structureId);
  if (!parsed.success) return null;
  const lessonId = lessonIdByStructure.get(parsed.data);
  return lessonId ? `/aprender/${lessonId}` : null;
}
