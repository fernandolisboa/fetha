import { describe, expect, it } from "vitest";

import { isResumableRunError } from "./strings";

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
});
