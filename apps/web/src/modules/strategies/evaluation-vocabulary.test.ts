import { describe, expect, it } from "vitest";

import { isWebEvaluationReason, webEvaluationReasons } from "./evaluation-vocabulary";

describe("isWebEvaluationReason", () => {
  it("accepts every code in the closed vocabulary", () => {
    for (const reason of webEvaluationReasons) {
      expect(isWebEvaluationReason(reason)).toBe(true);
    }
  });

  it("rejects an engine reason and an arbitrary string", () => {
    expect(isWebEvaluationReason("no_candles")).toBe(false);
    expect(isWebEvaluationReason("something_unrecognized")).toBe(false);
  });
});
