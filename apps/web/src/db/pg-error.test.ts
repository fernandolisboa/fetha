import { describe, expect, it } from "vitest";

import { postgresErrorOf } from "./pg-error";

function pgError(code: string): Error & { code: string; severity: string } {
  return Object.assign(new Error("db failure"), { code, severity: "ERROR" });
}

function drizzleQueryError(cause: unknown): Error {
  return new Error("Failed query: ...", { cause });
}

describe("postgresErrorOf", () => {
  it("returns a bare Postgres error", () => {
    expect(postgresErrorOf(pgError("23505"))?.code).toBe("23505");
  });

  it("unwraps the Postgres error drizzle puts on a DrizzleQueryError's cause", () => {
    expect(postgresErrorOf(drizzleQueryError(pgError("23505")))?.code).toBe("23505");
  });

  it("ignores a JS error that merely carries a string code", () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(postgresErrorOf(enoent)).toBeNull();
    expect(postgresErrorOf(drizzleQueryError(enoent))).toBeNull();
  });

  it("returns null for anything else", () => {
    expect(postgresErrorOf(new Error("boom"))).toBeNull();
    expect(postgresErrorOf(drizzleQueryError(new Error("boom")))).toBeNull();
    expect(postgresErrorOf("not an error")).toBeNull();
    expect(postgresErrorOf(null)).toBeNull();
  });
});
