import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestMock = vi.hoisted(() => vi.fn());
const evaluateSignalsMock = vi.hoisted(() => vi.fn());
const scoreDueDecisionsMock = vi.hoisted(() => vi.fn());
const purgeExpiredAccessLogMock = vi.hoisted(() => vi.fn());
const purgeUnverifiedAccountsMock = vi.hoisted(() => vi.fn());
const purgeExpiredSessionsMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/market-data", () => ({ ingest: ingestMock }));
vi.mock("@/modules/strategies", () => ({ evaluateSignalsForSession: evaluateSignalsMock }));
vi.mock("@/modules/decisions", () => ({ scoreDueDecisions: scoreDueDecisionsMock }));
vi.mock("@/modules/audit", () => ({ purgeExpiredAccessLog: purgeExpiredAccessLogMock }));
vi.mock("@/modules/auth", () => ({
  purgeUnverifiedAccounts: purgeUnverifiedAccountsMock,
  purgeExpiredSessions: purgeExpiredSessionsMock,
}));

const fakeDb = {} as never;

describe("runNightlyJob", () => {
  beforeEach(() => {
    ingestMock.mockReset();
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      ok: true,
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
    });
    purgeExpiredAccessLogMock.mockReset().mockResolvedValue({ ok: true, deleted: 0 });
    purgeUnverifiedAccountsMock.mockReset().mockResolvedValue({ ok: true, deleted: 0 });
    purgeExpiredSessionsMock.mockReset().mockResolvedValue({ ok: true, deleted: 0 });
    evaluateSignalsMock.mockReset();
    evaluateSignalsMock.mockResolvedValue({
      sessions: ["2026-09-08"],
      usersEvaluated: 0,
      usersSkipped: 0,
      signalsWritten: 0,
      evaluationsWritten: 0,
      errors: [],
    });
    scoreDueDecisionsMock
      .mockReset()
      .mockImplementation((_db: unknown, input: { okSessions: readonly string[] }) =>
        Promise.resolve({
          asOfSession: input.okSessions[0] ?? "",
          usersScored: 0,
          usersSkipped: 0,
          decisionsScored: 0,
          decisionsSkipped: 0,
          errors: [],
        }),
      );
  });

  it("runs ingestion with the given session", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb, { session: "2026-09-08" });
    expect(ingestMock).toHaveBeenCalledWith(fakeDb, { session: "2026-09-08" });
    expect(outcome.ok).toBe(true);
  });

  it("runs ingestion with no session when none is given", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    await runNightlyJob(fakeDb);
    expect(ingestMock).toHaveBeenCalledWith(fakeDb, {});
  });

  it("runs every retention purge before ingestion", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    const callOrder: string[] = [];
    purgeExpiredAccessLogMock.mockImplementation(() => {
      callOrder.push("accessLogPurge");
      return Promise.resolve({ ok: true, deleted: 0 });
    });
    purgeUnverifiedAccountsMock.mockImplementation(() => {
      callOrder.push("unverifiedAccountPurge");
      return Promise.resolve({ ok: true, deleted: 0 });
    });
    purgeExpiredSessionsMock.mockImplementation(() => {
      callOrder.push("sessionPurge");
      return Promise.resolve({ ok: true, deleted: 0 });
    });
    ingestMock.mockImplementation(() => {
      callOrder.push("ingest");
      return Promise.resolve({
        session: "2026-09-08",
        okSessions: ["2026-09-08"],
        ok: true,
        sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      });
    });

    await runNightlyJob(fakeDb);

    expect(callOrder).toEqual([
      "accessLogPurge",
      "unverifiedAccountPurge",
      "sessionPurge",
      "ingest",
    ]);
  });

  it("runs every retention purge even when ingestion throws (#146)", async () => {
    ingestMock.mockRejectedValue(new Error("database unreachable"));
    const { runNightlyJob } = await import("./run-nightly-job");

    await expect(runNightlyJob(fakeDb)).rejects.toThrow("database unreachable");

    expect(purgeExpiredAccessLogMock).toHaveBeenCalledTimes(1);
    expect(purgeUnverifiedAccountsMock).toHaveBeenCalledTimes(1);
    expect(purgeExpiredSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("chains the signal evaluation onto the session ingestion just reported", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(evaluateSignalsMock).toHaveBeenCalledWith(fakeDb, ["2026-09-08"], expect.any(Object));
    expect(outcome.evaluation).toMatchObject({
      sessions: ["2026-09-08"],
      usersEvaluated: 0,
      signalsWritten: 0,
    });
  });

  it("chains scoring onto the session ingestion just reported, after evaluation", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(scoreDueDecisionsMock).toHaveBeenCalledWith(
      fakeDb,
      { okSessions: ["2026-09-08"] },
      expect.any(Object),
    );
    expect(outcome.scoring).toMatchObject({ asOfSession: "2026-09-08", decisionsScored: 0 });
  });

  it("shares one deadline between evaluation and scoring", async () => {
    const { runNightlyJob } = await import("./run-nightly-job");
    await runNightlyJob(fakeDb);
    const evaluationDeadline: number = (
      evaluateSignalsMock.mock.calls[0]?.[2] as { deadlineAt: number }
    ).deadlineAt;
    const scoringDeadline: number = (
      scoreDueDecisionsMock.mock.calls[0]?.[2] as { deadlineAt: number }
    ).deadlineAt;
    expect(scoringDeadline).toBe(evaluationDeadline);
  });

  it("passes an empty okSessions to scoring when this run drains nothing new, letting it resolve its own fallback", async () => {
    ingestMock.mockResolvedValue({ session: null, okSessions: [], ok: true, sources: [] });
    const { runNightlyJob } = await import("./run-nightly-job");
    await runNightlyJob(fakeDb);
    expect(scoreDueDecisionsMock).toHaveBeenCalledWith(
      fakeDb,
      { okSessions: [] },
      expect.any(Object),
    );
  });

  it("skips the signal evaluation when ingestion reports no session", async () => {
    ingestMock.mockResolvedValue({ session: null, okSessions: [], ok: true, sources: [] });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(evaluateSignalsMock).not.toHaveBeenCalled();
    expect(outcome.evaluation).toBeNull();
  });

  it("reports ok:false when a source failed", async () => {
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: [],
      ok: false,
      sources: [{ source: "cotahist", skipped: false, rowCount: 0, error: "boom" }],
    });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(outcome.ok).toBe(false);
  });

  it("still evaluates the sessions cotahist drained when a different source failed", async () => {
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      ok: false,
      sources: [
        { source: "cotahist", skipped: false, rowCount: 10 },
        { source: "sgs", skipped: false, rowCount: 0, error: "boom" },
      ],
    });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(evaluateSignalsMock).toHaveBeenCalledWith(fakeDb, ["2026-09-08"], expect.any(Object));
    expect(outcome.evaluation).toMatchObject({ sessions: ["2026-09-08"] });
  });

  it("skips the signal evaluation when cotahist itself failed, even if okSessions reports one, and scoring gets an empty okSessions", async () => {
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      ok: false,
      sources: [{ source: "cotahist", skipped: false, rowCount: 0, error: "boom" }],
    });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(evaluateSignalsMock).not.toHaveBeenCalled();
    expect(scoreDueDecisionsMock).toHaveBeenCalledWith(
      fakeDb,
      { okSessions: [] },
      expect.any(Object),
    );
    expect(outcome.evaluation).toBeNull();
  });

  it("never fails the run when scoring itself errors", async () => {
    scoreDueDecisionsMock.mockResolvedValue({
      asOfSession: "2026-09-08",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 1,
      errors: [{ decisionId: "decision-1", kind: "engine_error:unresolvable_view" }],
    });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(outcome.ok).toBe(true);
    expect(outcome.scoring).toMatchObject({
      errors: [{ decisionId: "decision-1", kind: "engine_error:unresolvable_view" }],
    });
  });

  it("reports every purge outcome alongside the run", async () => {
    purgeExpiredAccessLogMock.mockResolvedValue({ ok: true, deleted: 3 });
    purgeUnverifiedAccountsMock.mockResolvedValue({ ok: true, deleted: 2 });
    purgeExpiredSessionsMock.mockResolvedValue({ ok: true, deleted: 1 });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(outcome.accessLogPurge).toEqual({ ok: true, deleted: 3 });
    expect(outcome.unverifiedAccountPurge).toEqual({ ok: true, deleted: 2 });
    expect(outcome.sessionPurge).toEqual({ ok: true, deleted: 1 });
  });

  it("reports a failed purge alongside an otherwise successful run", async () => {
    purgeExpiredAccessLogMock.mockResolvedValue({ ok: false });
    const { runNightlyJob } = await import("./run-nightly-job");
    const outcome = await runNightlyJob(fakeDb);
    expect(outcome.ok).toBe(true);
    expect(outcome.accessLogPurge).toEqual({ ok: false });
  });
});
