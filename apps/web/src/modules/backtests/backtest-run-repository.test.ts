import { describe, expect, it } from "vitest";

import { drizzleQueryError, postgresError } from "@/db/test/pg-error";

import { isImmutabilityTriggerError } from "./backtest-run-repository";

describe("isImmutabilityTriggerError", () => {
  it("matches a bare driver error with code P0001", () => {
    expect(isImmutabilityTriggerError(postgresError("P0001"))).toBe(true);
  });

  it("matches a DrizzleQueryError wrapping the trigger's P0001 as its cause (the shape this driver throws)", () => {
    expect(isImmutabilityTriggerError(drizzleQueryError(postgresError("P0001")))).toBe(true);
  });

  it("does not match an unrelated Postgres error code, wrapped or not", () => {
    expect(isImmutabilityTriggerError(postgresError("23505"))).toBe(false);
    expect(isImmutabilityTriggerError(drizzleQueryError(postgresError("23505")))).toBe(false);
  });

  it("does not match an error with no code at all, or a code without a driver's severity", () => {
    expect(isImmutabilityTriggerError(new Error("network blip"))).toBe(false);
    expect(isImmutabilityTriggerError({ code: "P0001", message: "not a driver error" })).toBe(
      false,
    );
    expect(isImmutabilityTriggerError(null)).toBe(false);
    expect(isImmutabilityTriggerError(undefined)).toBe(false);
  });
});
