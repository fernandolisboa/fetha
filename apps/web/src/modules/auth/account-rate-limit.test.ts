import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/client";

import {
  accountBucketKey,
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
} from "./account-rate-limit";

interface FakeRow {
  id: string;
  key: string;
  count: number;
  lastRequest: number;
}

function selectChain(row: FakeRow | undefined) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  };
}

function insertChain(behavior: () => Promise<unknown>) {
  return {
    values: behavior,
  };
}

function updateChain(returning: () => Promise<Array<{ id: string }>>) {
  return {
    set: () => ({
      where: () => ({
        returning,
      }),
    }),
  };
}

function buildFakeDb(options: {
  selects: Array<FakeRow | undefined>;
  inserts?: Array<() => Promise<unknown>>;
  updates?: Array<() => Promise<Array<{ id: string }>>>;
}): Database {
  const select = vi.fn();
  for (const row of options.selects) {
    select.mockReturnValueOnce(selectChain(row));
  }

  const insert = vi.fn();
  for (const behavior of options.inserts ?? []) {
    insert.mockReturnValueOnce(insertChain(behavior));
  }

  const update = vi.fn();
  for (const returning of options.updates ?? []) {
    update.mockReturnValueOnce(updateChain(returning));
  }

  const deleteRows = vi.fn(() => ({ where: () => Promise.resolve() }));

  return { select, insert, update, delete: deleteRows } as unknown as Database;
}

const RULE = { windowSeconds: 60, max: 3 };

describe("accountBucketKey", () => {
  it("never carries the email in clear", () => {
    const key = accountBucketKey("a@example.com", "/sign-in/email");
    expect(key).not.toContain("@");
    expect(key).not.toContain("example.com");
    expect(key).toMatch(/^account:[A-Za-z0-9_-]{43}\|\/sign-in\/email$/);
  });

  it("is stable per email and distinct across emails", () => {
    expect(accountBucketKey("a@example.com", "/p")).toBe(accountBucketKey("a@example.com", "/p"));
    expect(accountBucketKey("a@example.com", "/p")).not.toBe(
      accountBucketKey("b@example.com", "/p"),
    );
  });
});

describe("enforceAccountRateLimit", () => {
  it("creates a fresh counter row for a key with no prior request", async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const db = buildFakeDb({ selects: [undefined], inserts: [insertValues] });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).resolves.toBeUndefined();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        key: accountBucketKey("a@example.com", "/sign-in/email"),
        count: 1,
      }),
    );
  });

  it("refuses a rule whose window outlives the bucket retention", async () => {
    const db = buildFakeDb({ selects: [] });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/x", { windowSeconds: 61, max: 1 }),
    ).rejects.toThrow("exceeds the bucket retention");
  });

  it("allows a request when the count is one below max (count === max - 1)", async () => {
    const now = Date.now();
    const row: FakeRow = { id: "1", key: "k", count: RULE.max - 1, lastRequest: now - 1000 };
    const returning = vi.fn().mockResolvedValue([{ id: "1" }]);
    const db = buildFakeDb({ selects: [row], updates: [returning] });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).resolves.toBeUndefined();
    expect(returning).toHaveBeenCalled();
  });

  it("throws when the count is already at max and still within the window", async () => {
    const now = Date.now();
    const row: FakeRow = { id: "1", key: "k", count: RULE.max, lastRequest: now - 1000 };
    const failedIncrement = vi.fn().mockResolvedValue([]);
    const freshReadStillInWindow = row;
    const db = buildFakeDb({
      selects: [row, freshReadStillInWindow],
      updates: [failedIncrement],
    });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).rejects.toBeInstanceOf(AccountRateLimitExceededError);
  });

  it("treats a request exactly at the window boundary as expired (window-edge reset)", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const row: FakeRow = {
      id: "1",
      key: "k",
      count: RULE.max,
      lastRequest: now - RULE.windowSeconds * 1000,
    };
    const reset = vi.fn().mockResolvedValue([{ id: "1" }]);
    const db = buildFakeDb({ selects: [row], updates: [reset] });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).resolves.toBeUndefined();
    expect(reset).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("retries under the winner's row when a concurrent insert wins the race for a fresh key", async () => {
    const now = Date.now();
    const winnerRow: FakeRow = { id: "1", key: "k", count: 1, lastRequest: now };
    const insertRace = vi.fn().mockRejectedValue(new Error("duplicate key value"));
    const increment = vi.fn().mockResolvedValue([{ id: "1" }]);
    const db = buildFakeDb({
      selects: [undefined, winnerRow, winnerRow],
      inserts: [insertRace],
      updates: [increment],
    });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).resolves.toBeUndefined();
    expect(insertRace).toHaveBeenCalledTimes(1);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("never swallows a real insert error when the row still does not exist after it", async () => {
    const insertError = new Error("connection reset");
    const insertFailure = vi.fn().mockRejectedValue(insertError);
    const db = buildFakeDb({ selects: [undefined, undefined], inserts: [insertFailure] });

    await expect(enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE)).rejects.toBe(
      insertError,
    );
  });

  it("retries when a concurrent window reset already won, instead of admitting the request uncounted", async () => {
    const now = Date.now();
    const staleRow: FakeRow = {
      id: "1",
      key: "k",
      count: RULE.max,
      lastRequest: now - RULE.windowSeconds * 1000 - 1,
    };
    const winnerRow: FakeRow = { id: "1", key: "k", count: 1, lastRequest: now };
    const lostReset = vi.fn().mockResolvedValue([]);
    const increment = vi.fn().mockResolvedValue([{ id: "1" }]);
    const db = buildFakeDb({
      selects: [staleRow, winnerRow],
      updates: [lostReset, increment],
    });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).resolves.toBeUndefined();
    expect(lostReset).toHaveBeenCalledTimes(1);
    expect(increment).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of retries instead of recursing forever", async () => {
    const now = Date.now();
    const row: FakeRow = { id: "1", key: "k", count: RULE.max, lastRequest: now - 1000 };
    const selects = Array.from({ length: 30 }, () => row);
    const updates = Array.from({ length: 30 }, () => vi.fn().mockResolvedValue([]));
    const db = buildFakeDb({ selects, updates });

    await expect(
      enforceAccountRateLimit(db, "a@example.com", "/sign-in/email", RULE),
    ).rejects.toBeInstanceOf(AccountRateLimitExceededError);
  });
});
