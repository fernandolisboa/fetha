import { describe, expect, it } from "vitest";

import { reevaluationAnchors } from "./evaluation-log";
import type { EvaluationLogItem } from "./signals-repository";

function row(overrides: Partial<EvaluationLogItem> & { id: string }): EvaluationLogItem {
  return {
    strategyId: "s1",
    strategyName: "SMA",
    ticker: "PETR4",
    session: "2026-09-25",
    at: new Date("2026-09-25T21:00:00.000Z"),
    outcome: "signal",
    reason: "signal",
    detail: null,
    reevaluated: false,
    ...overrides,
  };
}

describe("reevaluationAnchors", () => {
  it("marks the first row of each strategy and session, skipping catch-up clamp rows", () => {
    const anchors = reevaluationAnchors([
      row({ id: "clamp", reason: "catchup_clamped", outcome: "insufficient_data", detail: "3" }),
      row({ id: "a", ticker: "PETR4" }),
      row({ id: "b", ticker: "VALE3" }),
      row({ id: "c", session: "2026-09-24" }),
      row({ id: "d", strategyId: "s2" }),
    ]);
    expect(anchors).toEqual(new Set(["a", "c", "d"]));
  });
});
