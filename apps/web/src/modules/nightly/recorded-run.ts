import type { Database } from "@/db/client";

import {
  buildNightlyRunReport,
  buildThrownNightlyRunReport,
  type NightlyRunReport,
} from "./report";
import { recordNightlyRun } from "./nightly-runs-repository";
import { runNightlyJob, type NightlyJobOptions, type NightlyJobOutcome } from "./run-nightly-job";
import type { NightlyRunTrigger } from "./schema";

// A report builder is arbitrary code (#220 review): if it throws, that must
// never surface as if the run itself had failed, so it is caught right here
// rather than by the caller's own try/catch. A build failure still leaves a
// row: the fallback report says only that building failed, never guesses at
// the run's own shape.
function buildReportSafely(build: () => NightlyRunReport): NightlyRunReport {
  try {
    return build();
  } catch (error) {
    console.error(
      "failed to build nightly run report",
      error instanceof Error ? error.name : "Unknown",
    );
    return { error: "report build failed" };
  }
}

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
  let outcome: NightlyJobOutcome;
  try {
    outcome = await runNightlyJob(db, options);
  } catch (error) {
    // Building and recording the thrown-run report happens outside this
    // try/catch's own scope (buildReportSafely never throws, and
    // recordNightlyRun never throws), so neither step can turn into a
    // second, different error that replaces the one about to be rethrown.
    await recordNightlyRun(db, {
      trigger,
      startedAt,
      finishedAt: new Date(),
      ok: false,
      report: buildReportSafely(() => buildThrownNightlyRunReport(error)),
    });
    throw error;
  }
  await recordNightlyRun(db, {
    trigger,
    startedAt,
    finishedAt: new Date(),
    ok: outcome.ok,
    report: buildReportSafely(() => buildNightlyRunReport(outcome)),
  });
  return outcome;
}
