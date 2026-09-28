import { describe, expect, it } from "vitest";

import {
  buildNightlyRunReport,
  buildThrownNightlyRunReport,
  nightlyRunReportSchema,
  sourceRunStatus,
} from "./report";
import type { NightlyJobOutcome } from "./run-nightly-job";

function baseOutcome(): NightlyJobOutcome {
  return {
    ok: true,
    session: "2026-09-08",
    okSessions: ["2026-09-08"],
    sources: [
      { source: "cotahist", skipped: false, rowCount: 10 },
      { source: "sgs", skipped: true, rowCount: 0 },
    ],
    evaluation: {
      sessions: ["2026-09-08"],
      usersEvaluated: 1,
      usersSkipped: 0,
      usersAlreadyCaughtUp: 0,
      strategiesDeferred: 0,
      signalsWritten: 3,
      evaluationsWritten: 5,
      errors: ["someone-elses-strategy-id: engine_error boom"],
    },
    scoring: {
      asOfSession: "2026-09-08",
      usersScored: 1,
      usersSkipped: 0,
      decisionsScored: 2,
      decisionsSkipped: 0,
      errors: [{ decisionId: "someone-elses-decision-id", kind: "engine_error:boom" }],
    },
    accessLogPurge: { ok: true, deleted: 4 },
    unverifiedAccountPurge: { ok: true, deleted: 0 },
    sessionPurge: { ok: true, deleted: 1 },
    nightlyRunPurge: { ok: true, deleted: 0 },
  };
}

describe("sourceRunStatus", () => {
  it("is failed when the source carries an error, regardless of skipped", () => {
    expect(sourceRunStatus({ skipped: false, error: "boom" })).toBe("failed");
    expect(sourceRunStatus({ skipped: true, error: "boom" })).toBe("failed");
  });

  it("is skipped when there is no error but the source was skipped", () => {
    expect(sourceRunStatus({ skipped: true })).toBe("skipped");
  });

  it("is ok when there is no error and the source was not skipped", () => {
    expect(sourceRunStatus({ skipped: false })).toBe("ok");
  });

  it("is pending when the provider has not published the session yet, unless it also failed", () => {
    expect(sourceRunStatus({ skipped: false, pending: true })).toBe("pending");
    expect(sourceRunStatus({ skipped: false, pending: true, error: "boom" })).toBe("failed");
  });
});

describe("buildNightlyRunReport", () => {
  it("keeps session, okSessions, per-source status/counts and every purge outcome", () => {
    const report = buildNightlyRunReport(baseOutcome());

    expect(report).toMatchObject({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [
        { source: "cotahist", status: "ok", rowCount: 10 },
        { source: "sgs", status: "skipped", rowCount: 0 },
      ],
      accessLogPurge: { ok: true, deleted: 4 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 1 },
      nightlyRunPurge: { ok: true, deleted: 0 },
    });
  });

  it("reduces evaluation and scoring to counts, never leaking a decisionId or an engine error string", () => {
    const report = buildNightlyRunReport(baseOutcome());

    expect(report).toMatchObject({
      evaluation: {
        signalsWritten: 3,
        strategiesDeferred: 0,
        usersSkipped: 0,
        errorCount: 1,
      },
      scoring: {
        decisionsScored: 2,
        usersSkipped: 0,
        decisionsSkipped: 0,
        errorCount: 1,
      },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("someone-elses-decision-id");
    expect(serialized).not.toContain("someone-elses-strategy-id");
    expect(serialized).not.toContain("engine_error:boom");
  });

  it("reports evaluation as null when the run skipped it", () => {
    const outcome = baseOutcome();
    outcome.evaluation = null;

    const report = buildNightlyRunReport(outcome);

    expect(report).toMatchObject({ evaluation: null });
  });

  it("keeps a source's own sanitized error string, and skippedRows when present", () => {
    const outcome = baseOutcome();
    outcome.sources = [
      { source: "cotahist", skipped: false, rowCount: 0, error: "23505" },
      { source: "instruments", skipped: false, rowCount: 8, skippedRows: 2 },
    ];

    const report = buildNightlyRunReport(outcome);

    expect(report).toMatchObject({
      sources: [
        { source: "cotahist", status: "failed", rowCount: 0, error: "23505" },
        { source: "instruments", status: "ok", rowCount: 8, skippedRows: 2 },
      ],
    });
  });

  it("reports a not-yet-published source as pending, not failed", () => {
    const outcome = baseOutcome();
    outcome.sources = [{ source: "sgs", skipped: false, rowCount: 0, pending: true }];

    const report = buildNightlyRunReport(outcome);

    expect(report).toMatchObject({
      sources: [{ source: "sgs", status: "pending", rowCount: 0 }],
    });
    expect(nightlyRunReportSchema.safeParse(report).success).toBe(true);
  });

  it("produces a report the schema accepts", () => {
    const report = buildNightlyRunReport(baseOutcome());
    expect(nightlyRunReportSchema.safeParse(report).success).toBe(true);
  });
});

describe("buildThrownNightlyRunReport", () => {
  it("reduces a Postgres error to its SQLSTATE plus constraint, never the driver message", () => {
    const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
      cause: { code: "23505", severity: "ERROR", constraint: "nightly_runs_pkey" },
    });

    const report = buildThrownNightlyRunReport(error);

    expect(report).toEqual({ error: "23505 (nightly_runs_pkey)" });
    expect(JSON.stringify(report)).not.toContain("duplicate key value");
  });

  it("keeps a plain error's own message, truncated, when it is not a Postgres error", () => {
    const report = buildThrownNightlyRunReport(new Error("database unreachable"));

    expect(report).toEqual({ error: "database unreachable" });
  });

  it("produces a report the schema accepts", () => {
    const report = buildThrownNightlyRunReport(new Error("boom"));
    expect(nightlyRunReportSchema.safeParse(report).success).toBe(true);
  });
});
