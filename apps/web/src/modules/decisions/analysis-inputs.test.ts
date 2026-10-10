import { describe, expect, it } from "vitest";
import type { AnalysisFacts } from "@fetha/contracts";

import { toAssembleResult } from "./analysis-inputs";

describe("toAssembleResult", () => {
  it("wraps a schema-valid fact tree as ok", () => {
    const result = toAssembleResult("signal", { ticker: "VALE3" });
    expect(result).toEqual({
      ok: true,
      inputs: { subject: "signal", facts: { ticker: "VALE3" } },
    });
  });

  it("maps an analysisInputsSchema parse failure to not_ready instead of throwing", () => {
    let deep: AnalysisFacts = { leaf: "x" };
    for (let level = 0; level < 30; level += 1) {
      deep = { nested: deep };
    }
    expect(() => toAssembleResult("signal", deep)).not.toThrow();
    expect(toAssembleResult("signal", deep)).toEqual({ ok: false, reason: "not_ready" });
  });
});
