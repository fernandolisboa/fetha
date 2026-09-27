import { and, asc, eq, gt } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { DataExportTables } from "@/lib/data-export";
import { UserScopedRepository, type ScopedUser } from "@/lib/user-scoped-repository";

import { backtestRuns } from "./schema";

// Runs carry a `result` and a `checkpoint` JSON blob each, so the export
// reads them a page at a time instead of loading every run a user has ever
// started in one query. Keyed on `id` alone, not `(created_at, id)`: Postgres
// `timestamptz` keeps microseconds but Drizzle round-trips `created_at` as a
// millisecond-precision JS `Date`, so a `created_at` cursor can be strictly
// smaller than the row it came from and re-match it forever. The export
// document promises rows are complete and each appears once, not any
// particular order.
const BACKTEST_RUNS_EXPORT_PAGE_SIZE = 25;

export class BacktestsDataExport extends UserScopedRepository {
  private readonly pageSize: number;

  constructor(db: Database, user: ScopedUser, pageSize: number = BACKTEST_RUNS_EXPORT_PAGE_SIZE) {
    super(db, user);
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError(`pageSize must be a positive integer, got ${String(pageSize)}`);
    }
    this.pageSize = pageSize;
  }

  tables(): Promise<DataExportTables> {
    return Promise.resolve({ backtest_runs: this.pagedRuns() });
  }

  private async *pagedRuns(): AsyncGenerator<object> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.db
        .select()
        .from(backtestRuns)
        .where(
          and(
            eq(backtestRuns.userId, this.userId),
            cursor ? gt(backtestRuns.id, cursor) : undefined,
          ),
        )
        .orderBy(asc(backtestRuns.id))
        .limit(this.pageSize);

      for (const run of page) {
        yield run;
      }

      const last = page.at(-1);
      if (!last || page.length < this.pageSize) {
        return;
      }
      cursor = last.id;
    }
  }
}
