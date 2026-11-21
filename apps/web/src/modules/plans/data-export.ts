import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { operationPlanRules, planSignals } from "./schema";

export class PlanRulesDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [rules, signals] = await Promise.all([
      this.db.select().from(operationPlanRules).where(eq(operationPlanRules.userId, this.userId)),
      this.db.select().from(planSignals).where(eq(planSignals.userId, this.userId)),
    ]);
    return { operation_plan_rules: rules, plan_signals: signals };
  }
}
