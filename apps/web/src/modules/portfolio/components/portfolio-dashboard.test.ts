import { describe, expect, it } from "vitest";

import type { OperationState } from "../operation-plan";
import { t } from "../strings";

import { corporateActionNotice } from "./portfolio-dashboard";

function baseState(corporateActionNormalizationSkipped?: boolean): OperationState {
  return {
    underlying: "PETR4",
    expiry: null,
    openedAt: "2026-01-02",
    status: "open",
    closedAt: null,
    legs: [],
    corporateActionNormalizationSkipped,
  };
}

describe("corporateActionNotice", () => {
  it("returns null when the operation has no state", () => {
    expect(corporateActionNotice(null)).toBeNull();
  });

  it("returns null when the state was not flagged", () => {
    expect(corporateActionNotice(baseState(false))).toBeNull();
    expect(corporateActionNotice(baseState(undefined))).toBeNull();
  });

  it("returns the muted pt-BR notice when a corporate-action rebase was skipped", () => {
    expect(corporateActionNotice(baseState(true))).toBe(
      t.dashboard.operations.corporateActionNotNormalized,
    );
  });
});
