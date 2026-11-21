import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { operationPlanRules } from "./schema";

export class PlanRulesDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const rules = await this.db
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.userId, this.userId));
    return { operation_plan_rules: rules };
  }
}
