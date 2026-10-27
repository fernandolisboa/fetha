import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { Database } from "@/db/client";

import { researchIdeas, researchIdeaScores } from "./schema";

// Only ids come out; every read and write after this goes through `ResearchScoresRepository`
// built with one.
export async function dueResearchUserIds(db: Database, asOfSession: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: researchIdeas.userId })
    .from(researchIdeas)
    .leftJoin(researchIdeaScores, eq(researchIdeaScores.ideaId, researchIdeas.id))
    .where(and(lte(researchIdeas.horizon, asOfSession), isNull(researchIdeaScores.id)))
    .orderBy(asc(researchIdeas.userId));
  return rows.map((row) => row.userId);
}
