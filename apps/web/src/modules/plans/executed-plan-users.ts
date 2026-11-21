import { asc, isNotNull } from "drizzle-orm";

import type { Database } from "@/db/client";

import { operationPlanRules } from "./schema";

// The nightly plan-signal evaluation's loop driver (ticket #381): the ids of every user with at
// least one executed plan (`operation_id is not null`), ascending and deterministic — the same
// rotation device `activeStrategyUserIds` uses is not needed here since every linked plan is
// cheap to re-check nightly, unlike a full strategy evaluation.
export async function executedPlanUserIds(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: operationPlanRules.userId })
    .from(operationPlanRules)
    .where(isNotNull(operationPlanRules.operationId))
    .orderBy(asc(operationPlanRules.userId));
  return rows.map((row) => row.userId);
}
