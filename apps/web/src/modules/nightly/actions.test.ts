import { beforeEach, describe, expect, it, vi } from "vitest";

const isOwnerMock = vi.hoisted(() => vi.fn());
const recordAccessMock = vi.hoisted(() => vi.fn());
const runNightlyJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/auth", () => ({ isOwner: isOwnerMock }));
vi.mock("@/modules/audit", () => ({ recordAccess: recordAccessMock }));
vi.mock("./run-nightly-job", () => ({ runNightlyJob: runNightlyJobMock }));

describe("triggerNightlyJobAction", () => {
  beforeEach(() => {
    isOwnerMock.mockReset();
    recordAccessMock.mockReset().mockResolvedValue(undefined);
    runNightlyJobMock.mockReset();
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: { signalsWritten: 3 },
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

  it("reports a skipped or failed source in the summary", async () => {
    runNightlyJobMock.mockResolvedValue({
      ok: false,
      session: "2026-09-08",
      okSessions: [],
      sources: [
        { source: "cotahist", skipped: false, rowCount: 0, error: "boom" },
        { source: "sgs", skipped: true, rowCount: 0 },
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
        ],
        signalsWritten: null,
      },
    });
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
});
