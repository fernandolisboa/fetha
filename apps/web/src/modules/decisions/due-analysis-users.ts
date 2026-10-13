import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { Database } from "@/db/client";

import { analysisResults, analysisScores } from "./schema";

// The nightly analysis scoring loop's driver (docs/adr/0058), the same shape
// as `dueDecisionUserIds`: only the ids of users with an accepted analysis
// whose outlook's horizon has arrived and that has no score yet. Every read
// and write after this goes through `AnalysisScoresRepository` built with
// that id.
export async function dueAnalysisUserIds(db: Database, asOfSession: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: analysisResults.userId })
    .from(analysisResults)
    .leftJoin(analysisScores, eq(analysisScores.requestId, analysisResults.requestId))
    .where(
      and(
        eq(analysisResults.outcome, "accepted"),
        lte(analysisResults.horizon, asOfSession),
        isNull(analysisScores.id),
      ),
    )
    .orderBy(asc(analysisResults.userId));
  return rows.map((row) => row.userId);
}
