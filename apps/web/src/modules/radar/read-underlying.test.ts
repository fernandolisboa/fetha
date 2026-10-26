import { describe, expect, it } from "vitest";
import { evaluationOutcomes } from "@fetha/engine";

import { entryStateOf } from "./read-underlying";

describe("entryStateOf", () => {
  it("holds for the outcomes recorded only after the entry condition held", () => {
    for (const outcome of [
      "signal",
      "unsizeable",
      "no_series_match",
      "degenerate_strikes",
    ] as const) {
      expect(entryStateOf(outcome)).toBe("held");
    }
  });

  it("separates conditions that were checked and not met from a check the engine could not make", () => {
    expect(entryStateOf("conditions_not_met")).toBe("conditions_not_met");
    expect(entryStateOf("insufficient_data")).toBe("not_evaluable");
  });

  it("classifies every outcome the engine can record", () => {
    for (const outcome of evaluationOutcomes) {
      expect(["held", "conditions_not_met", "not_evaluable"]).toContain(entryStateOf(outcome));
    }
  });
});
