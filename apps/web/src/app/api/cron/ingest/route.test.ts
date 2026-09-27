import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runNightlyJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/nightly", () => ({ runNightlyJob: runNightlyJobMock }));

describe("cron ingest route", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    runNightlyJobMock.mockReset();
    runNightlyJobMock.mockResolvedValue({
      ok: true,
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      sources: [{ source: "cotahist", skipped: false, rowCount: 10 }],
      evaluation: {
        sessions: ["2026-09-08"],
        usersEvaluated: 0,
        usersSkipped: 0,
        signalsWritten: 0,
        evaluationsWritten: 0,
        errors: [],
      },
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
    process.env.CRON_SECRET = originalSecret;
  });

  it("rejects GET without a bearer header", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/ingest"));
    expect(response.status).toBe(401);
    expect(runNightlyJobMock).not.toHaveBeenCalled();
  });

  it("rejects GET with the wrong bearer token", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("runs the nightly job on GET with the correct bearer", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(runNightlyJobMock).toHaveBeenCalledWith({});
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      ok: true,
      session: "2026-09-08",
      evaluation: { signalsWritten: 0 },
      scoring: { decisionsScored: 0 },
    });
  });

  it("returns 500 and ok:false when the nightly job reports a failed source", async () => {
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
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ok: false });
  });

  // The manual trigger moved to a session-authenticated Server Action (#51):
  // this route no longer exports a POST handler, so Next answers any POST
  // with its own default 405 instead of the route ever seeing CRON_SECRET
  // from a human.
  it("answers POST with 405 now that the manual trigger is gone", async () => {
    const route: Record<string, unknown> = await import("./route");
    expect(route.POST).toBeUndefined();
  });
});
