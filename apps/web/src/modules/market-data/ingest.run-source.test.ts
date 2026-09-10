import { beforeEach, describe, expect, it, vi } from "vitest";

const reapStaleRunningRuns = vi.fn();
const findSucceededRun = vi.fn();
const startRun = vi.fn();
const finishRun = vi.fn();
const deleteRun = vi.fn();
const withSourceLock = vi.fn();

vi.mock("./repositories/ingestion-run-repository", () => ({
  reapStaleRunningRuns,
  findSucceededRun,
  startRun,
  finishRun,
  deleteRun,
}));

vi.mock("./repositories/advisory-lock", () => ({
  withSourceLock,
}));

const { runSource } = await import("./ingest");

const db = {} as never;

beforeEach(() => {
  reapStaleRunningRuns.mockReset().mockResolvedValue(undefined);
  findSucceededRun.mockReset().mockResolvedValue(undefined);
  startRun.mockReset().mockResolvedValue("run-1");
  finishRun.mockReset().mockResolvedValue(undefined);
  deleteRun.mockReset().mockResolvedValue(undefined);
  withSourceLock.mockReset();
});

describe("runSource", () => {
  it("reports a transient error from reapStaleRunningRuns as a SourceOutcome instead of throwing", async () => {
    reapStaleRunningRuns.mockRejectedValueOnce(new Error("connection reset"));

    const outcome = await runSource(db, "cotahist", "2026-06-15", 300_000, () =>
      Promise.resolve(0),
    );

    expect(outcome).toMatchObject({
      source: "cotahist",
      skipped: false,
      rowCount: 0,
      error: "connection reset",
    });
    expect(startRun).not.toHaveBeenCalled();
    expect(finishRun).not.toHaveBeenCalled();
  });

  it("reports a transient error from startRun as a SourceOutcome without a run id to mark failed", async () => {
    startRun.mockRejectedValueOnce(new Error("pool exhausted"));

    const outcome = await runSource(db, "cotahist", "2026-06-15", 300_000, () =>
      Promise.resolve(0),
    );

    expect(outcome.error).toBe("pool exhausted");
    expect(finishRun).not.toHaveBeenCalled();
  });

  it("still marks the run failed when the error happens after startRun resolved", async () => {
    withSourceLock.mockRejectedValueOnce(new Error("fetch failed"));

    const outcome = await runSource(db, "cotahist", "2026-06-15", 300_000, () =>
      Promise.resolve(0),
    );

    expect(outcome.error).toBe("fetch failed");
    expect(finishRun).toHaveBeenCalledWith(db, "run-1", {
      status: "failed",
      error: "fetch failed",
    });
  });
});
