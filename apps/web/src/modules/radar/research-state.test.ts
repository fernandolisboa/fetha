import { describe, expect, it } from "vitest";

import type { ResearchResult } from "./research";
import { applyOutcome, initialResearchState } from "./research-state";

const result: ResearchResult = {
  newestClose: null,
  sessionsLooked: 1,
  candidates: 0,
  holding: [],
  noLongerHolding: [],
  dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
  usingDefaultProfile: true,
  timedOut: false,
};

describe("applyOutcome", () => {
  it("shows a successful research and clears an earlier error", () => {
    const failed = applyOutcome(initialResearchState, { status: "error", error: "unavailable" });
    expect(applyOutcome(failed, { status: "ok", result })).toEqual({ result, error: null });
  });

  it("keeps the last result on screen when the next research fails", () => {
    const shown = applyOutcome(initialResearchState, { status: "ok", result });
    expect(applyOutcome(shown, { status: "error", error: "rate_limited" })).toEqual({
      result,
      error: "rate_limited",
    });
  });

  it("has nothing to keep before the first research", () => {
    expect(applyOutcome(initialResearchState, { status: "error", error: "unavailable" })).toEqual({
      result: null,
      error: "unavailable",
    });
  });
});
