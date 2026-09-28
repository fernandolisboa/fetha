import { describe, expect, it, vi } from "vitest";

import type { NightlyRunReport } from "./report";
import { recordNightlyRun } from "./nightly-runs-repository";

function fakeDbThatFailsInsert() {
  return {
    insert: vi.fn(() => ({
      values: vi.fn().mockRejectedValue(new Error("connection reset")),
    })),
  } as never;
}

function fakeDbThatRecordsInsertedValues(sink: unknown[]) {
  return {
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        sink.push(values);
        return Promise.resolve();
      }),
    })),
  } as never;
}

describe("recordNightlyRun", () => {
  it("never throws when the insert fails, only logs the failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeDbThatFailsInsert();

    await expect(
      recordNightlyRun(db, {
        trigger: "cron",
        startedAt: new Date("2026-09-08T02:00:00Z"),
        finishedAt: new Date("2026-09-08T02:05:00Z"),
        ok: true,
        report: {
          session: null,
          okSessions: [],
          sources: [],
          accessLogPurge: { ok: false },
          unverifiedAccountPurge: { ok: false },
          sessionPurge: { ok: false },
          nightlyRunPurge: { ok: false },
          evaluation: null,
          scoring: { decisionsScored: 0, usersSkipped: 0, decisionsSkipped: 0, errorCount: 0 },
        },
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("logs no row data beyond the error", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = fakeDbThatFailsInsert();

    await recordNightlyRun(db, {
      trigger: "manual",
      startedAt: new Date(),
      finishedAt: new Date(),
      ok: false,
      report: { error: "23505" },
    });

    const [, detail] = consoleErrorSpy.mock.calls[0] as [string, string];
    expect(detail).toBe("Error");
    consoleErrorSpy.mockRestore();
  });

  it("logs a ZodError distinctly from an insert failure, with issue paths only, never the received values", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sink: unknown[] = [];
    const db = fakeDbThatRecordsInsertedValues(sink);

    await recordNightlyRun(db, {
      trigger: "cron",
      startedAt: new Date("2026-09-08T02:00:00Z"),
      finishedAt: new Date("2026-09-08T02:05:00Z"),
      ok: true,
      report: {
        session: "someone-elses-decision-id-leaked-here",
        okSessions: [],
        sources: [],
        // Missing every other required field: this must fail validation,
        // never reach the insert.
      } as unknown as NightlyRunReport,
    });

    expect(sink).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, issuePaths] = consoleErrorSpy.mock.calls[0] as [string, string[]];
    expect(message).toBe("nightly run report failed validation");
    expect(issuePaths.length).toBeGreaterThan(0);
    expect(JSON.stringify(issuePaths)).not.toContain("someone-elses-decision-id-leaked-here");
    consoleErrorSpy.mockRestore();
  });
});
