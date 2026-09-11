import { describe, expect, it } from "vitest";

import { isImmutabilityTriggerError } from "./backtest-run-repository";

// #18 round 5 item 6: CI's own network latency to Neon made the
// `backtest_runs_immutable_once_complete` trigger fire far more often than
// local runs did, exposing that `drizzle-orm/neon-serverless` never throws
// the driver's raw `pg`-shaped error — every failed query is wrapped in its
// own `DrizzleQueryError` (`Failed query: ...`), which carries the real
// error, `{ code: "P0001", ... }`, as `.cause` (drizzle-orm/errors.js).
// `isImmutabilityTriggerError` used to check `error.code` only, which never
// matched that wrapper, so the loser of a genuine race came back as a raw,
// unmapped `DrizzleQueryError` instead of `BacktestRunAlreadyCompleteError`.
describe("isImmutabilityTriggerError", () => {
  it("matches a raw driver-shaped error with code P0001 (the unwrapped shape a future driver might throw)", () => {
    expect(isImmutabilityTriggerError({ code: "P0001", message: "immutable" })).toBe(true);
  });

  it("matches a DrizzleQueryError wrapping the trigger's P0001 as its cause (the actual shape this driver throws)", () => {
    const wrapped = new Error('Failed query: update "backtest_runs" ...');
    (wrapped as Error & { cause?: unknown }).cause = {
      code: "P0001",
      message: "backtest_runs rows are immutable once complete",
    };
    expect(isImmutabilityTriggerError(wrapped)).toBe(true);
  });

  it("does not match an unrelated Postgres error code, wrapped or not", () => {
    expect(isImmutabilityTriggerError({ code: "23505", message: "unique violation" })).toBe(false);
    const wrapped = new Error("Failed query: insert ...");
    (wrapped as Error & { cause?: unknown }).cause = { code: "23505", message: "unique" };
    expect(isImmutabilityTriggerError(wrapped)).toBe(false);
  });

  it("does not match an error with no code at all", () => {
    expect(isImmutabilityTriggerError(new Error("network blip"))).toBe(false);
    expect(isImmutabilityTriggerError(null)).toBe(false);
    expect(isImmutabilityTriggerError(undefined)).toBe(false);
  });
});
