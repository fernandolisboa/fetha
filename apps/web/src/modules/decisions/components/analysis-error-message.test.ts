import { describe, expect, it } from "vitest";

import { analysisErrorMessage, type AnalysisErrorCode } from "./analysis-error-message";
import { t } from "../strings";

describe("analysisErrorMessage", () => {
  const codes: AnalysisErrorCode[] = [
    "invalid",
    "not_found",
    "not_ready",
    "unavailable",
    "own_key_unreadable",
    "rate_limited",
    "rejected",
    "failed",
  ];

  it.each(codes)("returns a non-empty sentence for %s", (code) => {
    expect(analysisErrorMessage(code, 50)).toBe(t.analysis.errors[code]);
  });

  it("interpolates the cap into cap_reached", () => {
    expect(analysisErrorMessage("cap_reached", 50)).toBe(t.analysis.errors.cap_reached(50));
    expect(analysisErrorMessage("cap_reached", 50)).toContain("50");
  });
});
