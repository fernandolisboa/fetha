import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isOwnerMock = vi.hoisted(() => vi.fn());
const recordAccessMock = vi.hoisted(() => vi.fn());
const runNightlyJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/auth", () => ({ isOwner: isOwnerMock }));
vi.mock("@/modules/audit", () => ({ recordAccess: recordAccessMock }));
vi.mock("./run-nightly-job", () => ({ runNightlyJob: runNightlyJobMock }));

describe("triggerNightlyJobAction", () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    isOwnerMock.mockReset();
    recordAccessMock.mockReset().mockResolvedValue(undefined);
    runNightlyJobMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: { signalsWritten: 3, errors: [] },
      scoring: {
        asOfSession: "2026-09-08",
        usersScored: 0,
        usersSkipped: 0,
        decisionsScored: 2,
        decisionsSkipped: 0,
        errors: [{ decisionId: "someone-elses-decision", kind: "engine_error:boom" }],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 0 },
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("is forbidden for a signed-out caller and never invokes the job", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08" });

    expect(result).toEqual({ status: "forbidden" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
    expect(recordAccessMock).not.toHaveBeenCalled();
  });

  it("is forbidden for a non-owner session and never invokes the job", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(result).toEqual({ status: "forbidden" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid session date even for the owner, without invoking the job", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "not-a-date" });

    expect(result).toEqual({ status: "invalid_input" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown field on the input even for the owner", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08", extra: "nope" });

    expect(result).toEqual({ status: "invalid_input" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
  });

  it("runs the nightly job for the owner, records the access and returns a redacted summary", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08" });

    expect(runNightlyJobMock).toHaveBeenCalledWith({}, { session: "2026-09-08" });
    expect(recordAccessMock).toHaveBeenCalledWith("nightly_triggered");
    expect(result).toEqual({
      status: "ok",
      summary: {
        ok: true,
        session: "2026-09-08",
        sources: [{ source: "cotahist", status: "ok" }],
        signalsWritten: 3,
        decisionsScored: 2,
        evaluationErrorCount: 0,
        scoringErrorCount: 1,
      },
    });
  });

  it("never leaks another user's decision id or a raw provider error to the summary", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(JSON.stringify(result)).not.toContain("someone-elses-decision");
    expect(JSON.stringify(result)).not.toContain("engine_error:boom");
  });

  it("reports a skipped, failed or pending source in the summary", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: false,
      session: "2026-09-08",
      okSessions: [],
      sources: [
        { source: "cotahist", skipped: false, rowCount: 0, error: "boom" },
        { source: "sgs", skipped: true, rowCount: 0 },
        { source: "instruments", skipped: false, rowCount: 0, pending: true },
      ],
      evaluation: null,
      scoring: {
        asOfSession: "",
        usersScored: 0,
        usersSkipped: 0,
        decisionsScored: 0,
        decisionsSkipped: 0,
        errors: [],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(result).toMatchObject({
      status: "ok",
      summary: {
        ok: false,
        sources: [
          { source: "cotahist", status: "failed" },
          { source: "sgs", status: "skipped" },
          { source: "instruments", status: "pending" },
        ],
        signalsWritten: null,
        evaluationErrorCount: 0,
        scoringErrorCount: 0,
      },
    });
  });

  it("logs the full outcome server-side when the run is not ok, without ever returning it", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: false,
      session: "2026-09-08",
      okSessions: [],
      sources: [{ source: "cotahist", skipped: false, rowCount: 0, error: "boom" }],
      evaluation: null,
      scoring: {
        asOfSession: "",
        usersScored: 0,
        usersSkipped: 0,
        decisionsScored: 0,
        decisionsSkipped: 0,
        errors: [],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [, loggedOutcome] = consoleErrorSpy.mock.calls[0] as [string, { sources: unknown[] }];
    expect(loggedOutcome.sources).toEqual([
      { source: "cotahist", skipped: false, rowCount: 0, error: "boom" },
    ]);
    expect(JSON.stringify(result)).not.toContain("boom");
  });

  it("logs the full outcome server-side when evaluation or scoring reports errors on an otherwise ok run", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    await triggerNightlyJobAction({});

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("never logs when the run is ok and evaluation and scoring report no errors", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: { signalsWritten: 3, errors: [] },
      scoring: {
        asOfSession: "2026-09-08",
        usersScored: 1,
        usersSkipped: 0,
        decisionsScored: 2,
        decisionsSkipped: 0,
        errors: [],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    await triggerNightlyJobAction({});

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs the full outcome server-side when a retention purge fails on an otherwise clean run", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: { signalsWritten: 3, errors: [] },
      scoring: {
        asOfSession: "2026-09-08",
        usersScored: 1,
        usersSkipped: 0,
        decisionsScored: 2,
        decisionsSkipped: 0,
        errors: [],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: false },
      sessionPurge: { ok: true, deleted: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "ok", summary: { ok: true } });
  });

  it("logs the full outcome server-side when the in-run deadline deferred or skipped work on an otherwise clean run", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: { signalsWritten: 3, errors: [], strategiesDeferred: 2, usersSkipped: 0 },
      scoring: {
        asOfSession: "2026-09-08",
        usersScored: 1,
        usersSkipped: 0,
        decisionsScored: 2,
        decisionsSkipped: 0,
        errors: [],
      },
      accessLogPurge: { ok: true, deleted: 0 },
      unverifiedAccountPurge: { ok: true, deleted: 0 },
      sessionPurge: { ok: true, deleted: 0 },
    });
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({});

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "ok", summary: { ok: true } });
  });

  it("rejects a second call while a run is already in progress", async () => {
    isOwnerMock.mockResolvedValue(true);
    let resolveJob: (() => void) | undefined;
    runNightlyJobMock.mockReturnValue(
      new Promise((resolve) => {
        resolveJob = () => {
          resolve({
            ok: true,
            session: "2026-09-08",
            okSessions: ["2026-09-08"],
            sources: [],
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
          });
        };
      }),
    );
    const { triggerNightlyJobAction } = await import("./actions");

    const firstCall = triggerNightlyJobAction({});
    await vi.waitFor(() => {
      expect(runNightlyJobMock).toHaveBeenCalledTimes(1);
    });

    const secondResult = await triggerNightlyJobAction({});
    expect(secondResult).toEqual({ status: "busy" });

    resolveJob?.();
    const firstResult = await firstCall;
    expect(firstResult.status).toBe("ok");

    const thirdResult = await triggerNightlyJobAction({});
    expect(thirdResult.status).toBe("ok");
  });

  it("releases the busy flag when the job rejects, so the next call is not stuck busy", async () => {
    isOwnerMock.mockResolvedValue(true);
    runNightlyJobMock.mockRejectedValueOnce(new Error("boom"));
    const { triggerNightlyJobAction } = await import("./actions");

    await expect(triggerNightlyJobAction({})).rejects.toThrow("boom");

    const secondResult = await triggerNightlyJobAction({});
    expect(secondResult.status).not.toBe("busy");
  });
});
