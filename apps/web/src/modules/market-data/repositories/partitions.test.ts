import { describe, expect, it } from "vitest";

import type { Database } from "@/db/client";
import { drizzleQueryError, postgresError } from "@/db/test/pg-error";

import { ensureMonthlyPartition } from "./partitions";

function rejectingDb(error: Error): Database {
  return { execute: () => Promise.reject(error) } as unknown as Database;
}

function wrapped(code: string): Error {
  return drizzleQueryError(postgresError(code));
}

describe("ensureMonthlyPartition", () => {
  it("swallows a concurrent caller's duplicate table error wrapped by drizzle", async () => {
    await expect(
      ensureMonthlyPartition(rejectingDb(wrapped("42P07")), "candles", "2031-06-01"),
    ).resolves.toBeUndefined();
  });

  it("swallows the pg_type unique violation a concurrent CREATE TABLE can raise instead", async () => {
    await expect(
      ensureMonthlyPartition(rejectingDb(wrapped("23505")), "candles", "2031-06-01"),
    ).resolves.toBeUndefined();
  });

  it("swallows an unwrapped duplicate table error", async () => {
    const error = postgresError("42P07");
    await expect(
      ensureMonthlyPartition(rejectingDb(error), "candles", "2031-06-01"),
    ).resolves.toBeUndefined();
  });

  it("rethrows a JS error that merely carries the same code", async () => {
    const error = Object.assign(new Error("not postgres"), { code: "42P07" });
    await expect(ensureMonthlyPartition(rejectingDb(error), "candles", "2031-06-01")).rejects.toBe(
      error,
    );
  });

  it("rethrows any other error", async () => {
    await expect(
      ensureMonthlyPartition(rejectingDb(wrapped("42501")), "candles", "2031-06-01"),
    ).rejects.toThrow("Failed query");
  });
});
