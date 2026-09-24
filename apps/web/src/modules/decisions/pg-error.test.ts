import { describe, expect, it } from "vitest";

import { classifyDecisionPersistenceError } from "./pg-error";

function pgError(
  code: string,
  constraint?: string,
): Error & { code: string; severity: string; constraint?: string } {
  return Object.assign(new Error("db failure"), { code, severity: "ERROR", constraint });
}

function wrapped(cause: unknown): Error {
  return new Error("Failed query: ...", { cause });
}

describe("classifyDecisionPersistenceError", () => {
  it("classifies a unique-violation as duplicate_signal", () => {
    expect(classifyDecisionPersistenceError(pgError("23505"))).toBe("duplicate_signal");
  });

  it("classifies the horizon check-constraint violation as invalid_horizon", () => {
    expect(
      classifyDecisionPersistenceError(
        pgError("23514", "decisions_horizon_on_or_after_decided_check"),
      ),
    ).toBe("invalid_horizon");
  });

  it("classifies the horizon check-constraint violation wrapped in a DrizzleQueryError", () => {
    expect(
      classifyDecisionPersistenceError(
        wrapped(pgError("23514", "decisions_horizon_on_or_after_decided_check")),
      ),
    ).toBe("invalid_horizon");
  });

  it("does not classify a different check-constraint violation as invalid_horizon", () => {
    expect(
      classifyDecisionPersistenceError(pgError("23514", "decisions_rationale_not_blank_check")),
    ).toBeNull();
  });

  it("does not classify a check-constraint violation with no constraint name", () => {
    expect(classifyDecisionPersistenceError(pgError("23514"))).toBeNull();
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
