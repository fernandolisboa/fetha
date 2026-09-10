import { describe, expect, it } from "vitest";
import type { EquityPoint } from "@fetha/engine";

import { sessionReturns } from "./report-panel";

function point(session: string, equity: number): EquityPoint {
  return { session, equity: equity as never, cash: 0 as never, drawdown: "0" as never };
}

describe("sessionReturns", () => {
  it("computes each session's return over the previous session's equity, not the starting capital", () => {
    const equityCurve = [point("2024-01-02", 100_000_00), point("2024-01-03", 101_000_00)];
    expect(sessionReturns(equityCurve)).toEqual([0.01]);
  });

  it("skips a session whose predecessor's equity is zero rather than dividing by zero", () => {
    const equityCurve = [point("2024-01-02", 0), point("2024-01-03", 1_000_00)];
    expect(sessionReturns(equityCurve)).toEqual([]);
  });
});
