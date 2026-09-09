import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";

import { consumePendingInviteSafely } from "./invite-repository";

function fakeThrowingDb(): Database {
  return {
    update: () => ({
      set: () => ({
        where: () => Promise.reject(new Error("invites table unavailable")),
      }),
    }),
  } as unknown as Database;
}

describe("consumePendingInviteSafely", () => {
  it("does not throw when consuming the invite fails, so registration still succeeds", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      consumePendingInviteSafely(fakeThrowingDb(), "test@example.com", "user-1"),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
