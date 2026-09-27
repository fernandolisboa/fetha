import { describe, expect, it } from "vitest";

import { DISCARDED_RUN_ERROR, MAX_ACTIVE_BACKTEST_RUNS } from "./backtest-run-repository";
import { backtestsStrings, isResumableRunError, runErrorMessage, t } from "./strings";

describe("isResumableRunError", () => {
  // `claim` clears `error` but never `dataVersion`, so retrying a run that
  // failed with `data_version_changed` compares the same stale
  // `dataVersion` against the same current view and is guaranteed to fail
  // with the identical code again (round 4 item 4).
  it("is false for data_version_changed, a retry that is guaranteed to re-fail", () => {
    expect(isResumableRunError("data_version_changed")).toBe(false);
  });

  it("is true for no_market_data, which a later ingestion run can resolve", () => {
    expect(isResumableRunError("no_market_data")).toBe(true);
  });

  it("is true for null, an engine failure with no stored web error code", () => {
    expect(isResumableRunError(null)).toBe(true);
  });

  it("is false for a discarded run: a discard is the user's own choice, not a transient failure", () => {
    expect(isResumableRunError(DISCARDED_RUN_ERROR)).toBe(false);
  });
});

describe("runErrorMessage for a discarded run", () => {
  it("renders the pt-BR label rather than the raw code", () => {
    expect(runErrorMessage(DISCARDED_RUN_ERROR)).toBe(t.discard.reason);
    expect(runErrorMessage(DISCARDED_RUN_ERROR)).not.toBe(DISCARDED_RUN_ERROR);
  });
});

describe("active-run cap copy", () => {
  it("states the cap the repository enforces, in words", () => {
    expect(MAX_ACTIVE_BACKTEST_RUNS).toBe(2);
    expect(backtestsStrings.en.tooManyActive).toContain("two backtests");
    expect(backtestsStrings.ptBR.tooManyActive).toContain("dois backtests");
  });
});
