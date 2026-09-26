import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.hoisted(() => vi.fn());
const enforceAccountRateLimitMock = vi.hoisted(() => vi.fn());
const recordAccessMock = vi.hoisted(() => vi.fn());
const accountExportStreamMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/modules/auth", () => {
  class UnauthenticatedError extends Error {}
  class AccountRateLimitExceededError extends Error {}
  return {
    UnauthenticatedError,
    AccountRateLimitExceededError,
    requireUser: requireUserMock,
    enforceAccountRateLimit: enforceAccountRateLimitMock,
  };
});
vi.mock("@/modules/audit", () => ({ recordAccess: recordAccessMock }));
vi.mock("@/modules/account", () => ({
  accountExportStream: accountExportStreamMock,
  exportFileName: () => "fetha-dados-2026-09-26.json",
  t: { dataExport: { rateLimited: "Muitas exportações seguidas." } },
}));

const owner = { id: "user-1", name: "Owner", email: "owner@example.com" };

describe("GET /api/account/export", () => {
  beforeEach(() => {
    requireUserMock.mockReset().mockResolvedValue(owner);
    enforceAccountRateLimitMock.mockReset().mockResolvedValue(undefined);
    recordAccessMock.mockReset().mockResolvedValue(undefined);
    accountExportStreamMock.mockReset().mockReturnValue(new Response('{"tables":{}}').body);
  });

  it("streams the signed-in user's export as an attachment and logs it", async () => {
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="fetha-dados-2026-09-26.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe('{"tables":{}}');
    expect(accountExportStreamMock).toHaveBeenCalledWith({}, owner, expect.any(Date));
    expect(recordAccessMock).toHaveBeenCalledWith("data_export");
  });

  it("refuses a caller with no session", async () => {
    const { UnauthenticatedError } = await import("@/modules/auth");
    requireUserMock.mockRejectedValue(new UnauthenticatedError());
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(accountExportStreamMock).not.toHaveBeenCalled();
    expect(recordAccessMock).not.toHaveBeenCalled();
  });

  it("answers 429 past the account rate limit, without exporting", async () => {
    const { AccountRateLimitExceededError } = await import("@/modules/auth");
    enforceAccountRateLimitMock.mockRejectedValue(new AccountRateLimitExceededError());
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(429);
    expect(await response.text()).toBe("Muitas exportações seguidas.");
    expect(enforceAccountRateLimitMock).toHaveBeenCalledWith({}, owner.email, "account/export", {
      windowSeconds: 60,
      max: 3,
    });
    expect(accountExportStreamMock).not.toHaveBeenCalled();
  });
});
