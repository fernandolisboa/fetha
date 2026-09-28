import { describe, expect, it, vi } from "vitest";

const runNightlyJobMock = vi.hoisted(() => vi.fn());
const recordNightlyRunMock = vi.hoisted(() => vi.fn());

vi.mock("./run-nightly-job", () => ({ runNightlyJob: runNightlyJobMock }));
vi.mock("./nightly-runs-repository", () => ({ recordNightlyRun: recordNightlyRunMock }));

const fakeDb = {} as never;

function baseOutcome() {
  return {
    ok: true,
    session: "2026-09-08",
    okSessions: ["2026-09-08"],
    sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
    evaluation: null,
    scoring: {
      asOfSession: "2026-09-08",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 0,
      errors: [],
    },
    accessLogPurge: { ok: true, deleted: 0 },
    unverifiedAccountPurge: { ok: true, deleted: 0 },
    sessionPurge: { ok: true, deleted: 0 },
    nightlyRunPurge: { ok: true, deleted: 0 },
  };
}

describe("runNightlyJobRecorded", () => {
  it("records one row for a completed run, with the given trigger and a redacted report", async () => {
    runNightlyJobMock.mockReset().mockResolvedValue(baseOutcome());
    recordNightlyRunMock.mockReset().mockResolvedValue(undefined);
    const { runNightlyJobRecorded } = await import("./recorded-run");

    const outcome = await runNightlyJobRecorded(fakeDb, "cron");

    expect(outcome).toEqual(baseOutcome());
    expect(recordNightlyRunMock).toHaveBeenCalledTimes(1);
    const [, row] = recordNightlyRunMock.mock.calls[0] as [
      unknown,
      { trigger: string; ok: boolean },
    ];
    expect(row.trigger).toBe("cron");
    expect(row.ok).toBe(true);
  });

  it("records ok:false with a sanitized error and rethrows the original error when the job throws", async () => {
    runNightlyJobMock.mockReset().mockRejectedValue(new Error("database unreachable"));
    recordNightlyRunMock.mockReset().mockResolvedValue(undefined);
    const { runNightlyJobRecorded } = await import("./recorded-run");

    await expect(runNightlyJobRecorded(fakeDb, "manual")).rejects.toThrow("database unreachable");

    expect(recordNightlyRunMock).toHaveBeenCalledTimes(1);
    const [, row] = recordNightlyRunMock.mock.calls[0] as [
      unknown,
      { trigger: string; ok: boolean; report: unknown },
    ];
    expect(row.trigger).toBe("manual");
    expect(row.ok).toBe(false);
    expect(row.report).toEqual({ error: "database unreachable" });
  });

  it("sanitizes a Postgres error thrown by the job to its SQLSTATE, never the driver message", async () => {
    const error = Object.assign(new Error("duplicate key value violates unique constraint"), {
      cause: { code: "23505", severity: "ERROR" },
    });
    runNightlyJobMock.mockReset().mockRejectedValue(error);
    recordNightlyRunMock.mockReset().mockResolvedValue(undefined);
    const { runNightlyJobRecorded } = await import("./recorded-run");

    await expect(runNightlyJobRecorded(fakeDb, "cron")).rejects.toBe(error);

    const [, row] = recordNightlyRunMock.mock.calls[0] as [unknown, { report: { error: string } }];
    expect(row.report.error).toBe("23505");
  });
});
