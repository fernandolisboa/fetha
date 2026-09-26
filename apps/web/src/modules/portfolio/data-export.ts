import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { contemplatedOperations, fills, operations, riskProfiles } from "./schema";

export class PortfolioDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    const [contemplated, profiles, ownOperations, ownFills] = await Promise.all([
      this.db
        .select()
        .from(contemplatedOperations)
        .where(eq(contemplatedOperations.userId, this.userId)),
      this.db.select().from(riskProfiles).where(eq(riskProfiles.userId, this.userId)),
      this.db.select().from(operations).where(eq(operations.userId, this.userId)),
      this.db.select().from(fills).where(eq(fills.userId, this.userId)),
    ]);
    return {
      contemplated_operations: contemplated,
      risk_profiles: profiles,
      operations: ownOperations,
      fills: ownFills,
    };
  }
}
