import { describe, expect, it } from "vitest";
import type { RiskProfile } from "@fetha/contracts";
import type { BacktestRun, EquityPoint, Note } from "@fetha/engine";

import {
  declaredLimitValues,
  generalNotesFor,
  limitModeLabel,
  sessionReturns,
  surfacedNoteCodes,
} from "./report-panel";

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

describe("declaredLimitValues", () => {
  it("formats every limit so an empty breaches table still shows what was checked", () => {
    const limits: RiskProfile["limits"] = {
      maxLossPerOperation: "0.02" as never,
      maxExposurePerOperation: "0.1" as never,
      maxOpenOperations: 5,
      maxPremiumBought: "0.05" as never,
    };
    expect(declaredLimitValues(limits)).toEqual({
      maxLossPerOperation: "2%",
      maxExposurePerOperation: "10%",
      maxOpenOperations: "5",
      maxPremiumBought: "5%",
    });
  });
});

describe("limitModeLabel", () => {
  it("labels enforce and warn distinctly", () => {
    expect(limitModeLabel("enforce")).not.toBe(limitModeLabel("warn"));
  });
});

function note(code: Note["code"]): Note {
  return { code, message: code };
}

function runWithNotes(notes: Note[]): BacktestRun {
  return { notes } as unknown as BacktestRun;
}

describe("generalNotesFor", () => {
  it("excludes the option-strike-across-corporate-action note, which the operations table surfaces instead (round 2 item 6)", () => {
    expect(surfacedNoteCodes).toContain("option_strike_unadjusted_across_corporate_action");
    const run = runWithNotes([note("option_strike_unadjusted_across_corporate_action")]);
    expect(generalNotesFor(run)).toEqual([]);
  });

  it("keeps a note whose code no panel already surfaces", () => {
    const run = runWithNotes([note("stale_price")]);
    expect(generalNotesFor(run)).toEqual([note("stale_price")]);
  });
});
