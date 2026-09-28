import { describe, expect, it, vi } from "vitest";

import { recordNightlyRun } from "./nightly-runs-repository";

function fakeDbThatFailsInsert() {
  return {
    insert: vi.fn(() => ({
      values: vi.fn().mockRejectedValue(new Error("connection reset")),
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
});
