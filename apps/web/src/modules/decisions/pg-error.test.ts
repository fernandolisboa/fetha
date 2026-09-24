import { describe, expect, it } from "vitest";

import { classifyDecisionPersistenceError } from "./pg-error";

function pgError(code: string): Error & { code: string; severity: string } {
  return Object.assign(new Error("db failure"), { code, severity: "ERROR" });
}

function wrapped(cause: unknown): Error {
  return new Error("Failed query: ...", { cause });
}

describe("classifyDecisionPersistenceError", () => {
  it("classifies a unique-violation as duplicate_signal", () => {
    expect(classifyDecisionPersistenceError(pgError("23505"))).toBe("duplicate_signal");
  });

  it("classifies a check-constraint violation as invalid_horizon", () => {
    expect(classifyDecisionPersistenceError(pgError("23514"))).toBe("invalid_horizon");
  });

  it("classifies a serialization-failure or lock-not-available error as a conflict", () => {
    expect(classifyDecisionPersistenceError(pgError("40001"))).toBe("conflict");
    expect(classifyDecisionPersistenceError(pgError("40P01"))).toBe("conflict");
  });

  it("classifies any other Postgres error as unavailable", () => {
    expect(classifyDecisionPersistenceError(pgError("57014"))).toBe("unavailable");
  });

  it("unwraps a DrizzleQueryError's cause to find the Postgres error", () => {
    expect(classifyDecisionPersistenceError(wrapped(pgError("23505")))).toBe("duplicate_signal");
  });

  it("does not classify a JS error that merely happens to carry a string code", () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(classifyDecisionPersistenceError(enoent)).toBeNull();
  });

  it("does not classify an ordinary error, so the caller rethrows it", () => {
    expect(classifyDecisionPersistenceError(new Error("boom"))).toBeNull();
    expect(classifyDecisionPersistenceError(wrapped(new Error("boom")))).toBeNull();
    expect(classifyDecisionPersistenceError("not an error")).toBeNull();
    expect(classifyDecisionPersistenceError(null)).toBeNull();
  });
});
