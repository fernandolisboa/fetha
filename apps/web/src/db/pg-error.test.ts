import { describe, expect, it } from "vitest";

import { postgresErrorOf, safeDbErrorMessage } from "./pg-error";
import { drizzleQueryError, postgresError as pgError } from "./test/pg-error";

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

describe("safeDbErrorMessage", () => {
  it("reduces a drizzle-wrapped Postgres error to its code", () => {
    const error = drizzleQueryError(pgError("23505"));

    expect(safeDbErrorMessage(error)).toBe("23505");
  });

  it("includes the violated constraint alongside the code when the driver reports one", () => {
    const error = drizzleQueryError(pgError("23514", { constraint: "check_positive" }));

    expect(safeDbErrorMessage(error)).toBe("23514 (check_positive)");
  });

  it("never leaks the SQL statement or bound params of a drizzle query failure", () => {
    const error = drizzleQueryError(pgError("57014"));

    const message = safeDbErrorMessage(error);

    expect(message).not.toContain("Failed query");
    expect(message).not.toContain("params:");
  });

  it("falls back to a generic message for a drizzle query failure with no Postgres-shaped cause", () => {
    const error = drizzleQueryError(new Error("connection reset"));

    const message = safeDbErrorMessage(error);

    expect(message).toBe("database query failed");
    expect(message).not.toContain("Failed query");
  });

  it("truncates a plain error's message instead of dropping it", () => {
    const error = new Error("a".repeat(500));

    const message = safeDbErrorMessage(error);

    expect(message.length).toBeLessThan(500);
    expect(message.startsWith("a".repeat(200))).toBe(true);
  });

  it("keeps a short plain error message intact", () => {
    expect(safeDbErrorMessage(new Error("no trading session recorded for 2026-06-15"))).toBe(
      "no trading session recorded for 2026-06-15",
    );
  });

  it("reports unknown error for a non-Error thrown value", () => {
    expect(safeDbErrorMessage("boom")).toBe("unknown error");
    expect(safeDbErrorMessage(undefined)).toBe("unknown error");
  });

  it("reports unknown error for an Error with an empty message instead of an empty string", () => {
    expect(safeDbErrorMessage(new Error(""))).toBe("unknown error");
  });
});
