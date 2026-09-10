import { describe, expect, it } from "vitest";

import { classifyPersistenceError } from "./pg-error";

function pgError(code: string): Error & { code: string; severity: string } {
  return Object.assign(new Error("db failure"), { code, severity: "ERROR" });
}

function wrapped(cause: unknown): Error {
  return new Error("Failed query: ...", { cause });
}

describe("classifyPersistenceError", () => {
  it("classifies a unique-violation Postgres error as a conflict", () => {
    expect(classifyPersistenceError(pgError("23505"))).toBe("conflict");
  });

  it("classifies a serialization-failure or lock-not-available error as a conflict", () => {
    expect(classifyPersistenceError(pgError("40001"))).toBe("conflict");
    expect(classifyPersistenceError(pgError("40P01"))).toBe("conflict");
  });

  it("classifies any other Postgres error as unavailable", () => {
    expect(classifyPersistenceError(pgError("57014"))).toBe("unavailable");
  });

  it("unwraps a DrizzleQueryError's cause to find the Postgres error", () => {
    expect(classifyPersistenceError(wrapped(pgError("23505")))).toBe("conflict");
  });

  it("does not classify a JS error that merely happens to carry a string code", () => {
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(classifyPersistenceError(enoent)).toBeNull();
  });

  it("does not classify an ordinary error, so the caller rethrows it", () => {
    expect(classifyPersistenceError(new Error("boom"))).toBeNull();
    expect(classifyPersistenceError(wrapped(new Error("boom")))).toBeNull();
    expect(classifyPersistenceError("not an error")).toBeNull();
    expect(classifyPersistenceError(null)).toBeNull();
  });
});
