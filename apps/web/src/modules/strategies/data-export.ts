import { eq, getTableColumns } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { evaluations, signals, strategies, strategyVersions } from "./schema";

export class StrategiesDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [ownStrategies, versions, ownSignals, ownEvaluations] = await Promise.all([
      this.db.select().from(strategies).where(eq(strategies.userId, this.userId)),
      this.db
        .select(getTableColumns(strategyVersions))
        .from(strategyVersions)
        .innerJoin(strategies, eq(strategies.id, strategyVersions.strategyId))
        .where(eq(strategies.userId, this.userId)),
      this.db.select().from(signals).where(eq(signals.userId, this.userId)),
      this.db.select().from(evaluations).where(eq(evaluations.userId, this.userId)),
    ]);
    return {
      strategies: ownStrategies,
      strategy_versions: versions,
      signals: ownSignals,
      evaluations: ownEvaluations,
    };
  }
}
