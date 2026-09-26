import { eq } from "drizzle-orm";

import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { backtestRuns } from "./schema";

export class BacktestsDataExport extends UserScopedRepository {
  async tables(): Promise<DataExportTables> {
    return {
      backtest_runs: await this.db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.userId, this.userId)),
    };
  }
}
