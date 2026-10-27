import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { Database } from "@/db/client";

import { researchIdeas, researchIdeaScores } from "./schema";

// The nightly research scoring loop's driver (docs/adr/0076), the same shape as
// `dueAnalysisUserIds`: only the ids of users with a research idea whose horizon has arrived and
// that has no score yet. Every read and write after this goes through `ResearchScoresRepository`
// built with that id.
export async function dueResearchUserIds(db: Database, asOfSession: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: researchIdeas.userId })
    .from(researchIdeas)
    .leftJoin(researchIdeaScores, eq(researchIdeaScores.ideaId, researchIdeas.id))
    .where(and(lte(researchIdeas.horizon, asOfSession), isNull(researchIdeaScores.id)))
    .orderBy(asc(researchIdeas.userId));
  return rows.map((row) => row.userId);
}
