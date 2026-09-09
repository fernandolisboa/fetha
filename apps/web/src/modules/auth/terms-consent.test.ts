import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";

import { recordTermsAcceptanceHistory } from "./terms-consent";

function fakeThrowingDb(): Database {
  return {
    insert: () => ({
      values: () => Promise.reject(new Error("history table unavailable")),
    }),
  } as unknown as Database;
}

describe("recordTermsAcceptanceHistory", () => {
  it("does not throw when the history write fails, so registration still succeeds", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordTermsAcceptanceHistory(fakeThrowingDb(), {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        termsAcceptedAt: new Date("2026-09-09T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
