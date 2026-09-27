import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isOwnerMock = vi.hoisted(() => vi.fn());
const runNightlyJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return { ...actual, isOwner: isOwnerMock };
});

vi.mock("./run-nightly-job", () => ({ runNightlyJob: runNightlyJobMock }));

describe("triggerNightlyJobAction", () => {
  beforeEach(() => {
    isOwnerMock.mockReset();
    runNightlyJobMock.mockReset();
    runNightlyJobMock.mockResolvedValue({
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
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("is forbidden for a signed-out caller and never invokes the job", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08" });

    expect(result).toEqual({ status: "forbidden" });
    expect(runNightlyJobMock).not.toHaveBeenCalled();
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

  it("runs the nightly job for the owner and returns its outcome", async () => {
    isOwnerMock.mockResolvedValue(true);
    const { triggerNightlyJobAction } = await import("./actions");

    const result = await triggerNightlyJobAction({ session: "2026-09-08" });

    expect(runNightlyJobMock).toHaveBeenCalledWith({}, { session: "2026-09-08" });
    expect(result).toMatchObject({ status: "ok", outcome: { ok: true, session: "2026-09-08" } });
  });
});
