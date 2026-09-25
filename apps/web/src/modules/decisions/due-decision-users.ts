import { and, asc, eq, isNull, lte } from "drizzle-orm";

import type { Database } from "@/db/client";

import { decisions, decisionScores } from "./schema";

// The nightly scoring job's loop driver (brief item 2), the same shape
// `activeStrategyUserIds` (strategies/active-strategy-users.ts) gives
// `evaluateSignalsForSession`: the ids of every user with at least one
// decision due for scoring, nothing else about their decisions. Every
// per-user read and write after this goes through `DecisionScoresRepository`
// constructed with that id, never an unscoped query a user-reachable path
// could also reach (CLAUDE.md principle 5).
export async function dueDecisionUserIds(db: Database, asOfSession: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: decisions.userId })
    .from(decisions)
    .leftJoin(decisionScores, eq(decisionScores.decisionId, decisions.id))
    .where(and(lte(decisions.horizon, asOfSession), isNull(decisionScores.id)))
    .orderBy(asc(decisions.userId));
  return rows.map((row) => row.userId);
}
