import type { Database } from "@/db/client";

import { buildNightlyRunReport, buildThrownNightlyRunReport } from "./report";
import { recordNightlyRun } from "./nightly-runs-repository";
import { runNightlyJob, type NightlyJobOptions, type NightlyJobOutcome } from "./run-nightly-job";
import type { NightlyRunTrigger } from "./schema";

// The one place both the cron GET handler and the owner's manual Server
// Action call runNightlyJob from (#220): each run, whichever path started
// it, gets exactly one nightly_runs row, redacted before it is written
// (../report.ts) and recorded without ever changing the run's own response
// or status code — a run that throws is still recorded (ok: false, a
// sanitized message) before the original error is rethrown unchanged, and a
// failed insert is caught and logged, never surfaced to the caller.
export async function runNightlyJobRecorded(
  db: Database,
  trigger: NightlyRunTrigger,
  options: NightlyJobOptions = {},
): Promise<NightlyJobOutcome> {
  const startedAt = new Date();
  try {
    const outcome = await runNightlyJob(db, options);
    await recordNightlyRun(db, {
      trigger,
      startedAt,
      finishedAt: new Date(),
      ok: outcome.ok,
      report: buildNightlyRunReport(outcome),
    });
    return outcome;
  } catch (error) {
    await recordNightlyRun(db, {
      trigger,
      startedAt,
      finishedAt: new Date(),
      ok: false,
      report: buildThrownNightlyRunReport(error),
    });
    throw error;
  }
}
