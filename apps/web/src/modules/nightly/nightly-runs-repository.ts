import { lt } from "drizzle-orm";
import { ZodError } from "zod";

import type { Database } from "@/db/client";

import { nightlyRunReportSchema, type NightlyRunReport } from "./report";
import { nightlyRuns, type NightlyRunTrigger } from "./schema";

export const NIGHTLY_RUN_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NightlyRunPurgeOutcome = { ok: true; deleted: number } | { ok: false };

export interface NewNightlyRun {
  trigger: NightlyRunTrigger;
  startedAt: Date;
  finishedAt: Date;
  ok: boolean;
  report: NightlyRunReport;
}

// Never throws: a failed insert must not change the run's own response or
// status code (docs/adr/0045). The caller already has everything worth
// knowing (the outcome or the thrown error) logged elsewhere; this only
// logs the insert's own failure, with no row data beyond the error.
export async function recordNightlyRun(db: Database, row: NewNightlyRun): Promise<void> {
  let report: NightlyRunReport;
  try {
    report = nightlyRunReportSchema.parse(row.report);
  } catch (error) {
    if (error instanceof ZodError) {
      // Never the received values: a redaction bug in a builder could put an
      // id or an error string where a count belongs, and that is exactly
      // what must not reach a log line.
      console.error(
        "nightly run report failed validation",
        error.issues.map((issue) => issue.path.join(".")),
      );
      return;
    }
    console.error("failed to record nightly run", error instanceof Error ? error.name : "Unknown");
    return;
  }
  try {
    await db.insert(nightlyRuns).values({ ...row, report });
  } catch (error) {
    console.error("failed to record nightly run", error instanceof Error ? error.name : "Unknown");
  }
}

// A system job over its own table, run by the nightly job itself, the same
// shape as the other retention purges it runs alongside (docs/adr/0027,
// 0033).
export async function purgeExpiredNightlyRuns(
  db: Database,
  now: Date = new Date(),
): Promise<NightlyRunPurgeOutcome> {
  const cutoff = new Date(now.getTime() - NIGHTLY_RUN_RETENTION_DAYS * DAY_MS);
  try {
    const deleted = await db
      .delete(nightlyRuns)
      .where(lt(nightlyRuns.startedAt, cutoff))
      .returning({ id: nightlyRuns.id });
    return { ok: true, deleted: deleted.length };
  } catch (error) {
    console.error("nightly run purge failed", error instanceof Error ? error.name : "Unknown");
    return { ok: false };
  }
}
