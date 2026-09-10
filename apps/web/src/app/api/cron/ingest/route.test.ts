import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ingestMock = vi.hoisted(() => vi.fn());
const evaluateSignalsMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/market-data", () => ({ ingest: ingestMock }));
vi.mock("@/modules/strategies", () => ({ evaluateSignalsForSession: evaluateSignalsMock }));

describe("cron ingest route", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    ingestMock.mockReset();
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      ok: true,
      sources: [],
    });
    evaluateSignalsMock.mockReset();
    evaluateSignalsMock.mockResolvedValue({
      sessions: ["2026-09-08"],
      usersEvaluated: 0,
      usersSkipped: [],
      signalsWritten: 0,
      evaluationsWritten: 0,
      errors: [],
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("rejects GET without a bearer header", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/cron/ingest"));
    expect(response.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
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

  it("runs ingestion on GET with the correct bearer", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith({}, {});
  });

  it("chains the signal evaluation onto the session ingestion just reported", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(evaluateSignalsMock).toHaveBeenCalledWith({}, ["2026-09-08"], expect.any(Object));
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      evaluation: { sessions: ["2026-09-08"], usersEvaluated: 0, signalsWritten: 0 },
    });
  });

  it("skips the signal evaluation when ingestion reports no session", async () => {
    ingestMock.mockResolvedValue({ session: null, okSessions: [], ok: true, sources: [] });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(evaluateSignalsMock).not.toHaveBeenCalled();
    const body: unknown = await response.json();
    expect(body).toMatchObject({ evaluation: null });
  });

  it("returns 500 and ok:false when a source failed", async () => {
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: [],
      ok: false,
      sources: [{ source: "cotahist", skipped: false, rowCount: 0, error: "boom" }],
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

  it("skips the signal evaluation when ingestion reports a session but result.ok is false", async () => {
    ingestMock.mockResolvedValue({
      session: "2026-09-08",
      okSessions: ["2026-09-08"],
      ok: false,
      sources: [{ source: "sgs", skipped: false, rowCount: 0, error: "boom" }],
    });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/cron/ingest", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(500);
    expect(evaluateSignalsMock).not.toHaveBeenCalled();
    const body: unknown = await response.json();
    expect(body).toMatchObject({ evaluation: null });
  });

  it("rejects POST without a bearer header", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/cron/ingest", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("accepts an optional session date on the manual POST trigger", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ session: "2026-09-08" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith({}, { session: "2026-09-08" });
  });

  it("rejects a malformed session date on POST", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ session: "not-a-date" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown field on the manual trigger body", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
        body: JSON.stringify({ session: "2026-09-08", extra: "nope" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("runs ingestion on POST with a bearer and no body", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(ingestMock).toHaveBeenCalledWith({}, {});
  });
});
