import { and, asc, eq, gt, or } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository, type ScopedUser } from "@/lib/user-scoped-repository";

import { backtestRuns } from "./schema";

// Runs carry a `result` and a `checkpoint` JSON blob each, so the export
// reads them a page at a time instead of loading every run a user has ever
// started in one query.
export const BACKTEST_RUNS_EXPORT_PAGE_SIZE = 100;

export class BacktestsDataExport extends UserScopedRepository {
  constructor(
    db: Database,
    user: ScopedUser,
    private readonly pageSize: number = BACKTEST_RUNS_EXPORT_PAGE_SIZE,
  ) {
    super(db, user);
  }

  async tables(): Promise<DataExportTables> {
    return { backtest_runs: this.pagedRuns() };
  }

  private async *pagedRuns(): AsyncGenerator<object> {
    let cursor: { createdAt: Date; id: string } | null = null;
    for (;;) {
      const page = await this.db
        .select()
        .from(backtestRuns)
        .where(
          and(
            eq(backtestRuns.userId, this.userId),
            cursor
              ? or(
                  gt(backtestRuns.createdAt, cursor.createdAt),
                  and(eq(backtestRuns.createdAt, cursor.createdAt), gt(backtestRuns.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(backtestRuns.createdAt), asc(backtestRuns.id))
        .limit(this.pageSize);

      for (const run of page) {
        yield run;
      }

      const last = page.at(-1);
      if (!last || page.length < this.pageSize) {
        return;
      }
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }
}
