import { cache } from "react";

import { getDb } from "@/db/client";
import { requireUser } from "@/modules/auth";

import { PlanRulesRepository, type SavedPlanRules } from "./plan-rules-repository";

// Every saved plan's rules this user has, keyed by the contemplated operation it extends
// (ADR-0079, ticket #381): the Carteira's own saved-operations list reads this to know which
// rows are plans (and so get an "Executei" button) versus a plain builder-saved operation.
export const getMyPlanRulesByOperation = cache(async (): Promise<Map<string, SavedPlanRules>> => {
  const user = await requireUser();
  const rows = await new PlanRulesRepository(getDb(), user).listMine();
  return new Map(rows.map((row) => [row.contemplatedOperationId, row]));
});
