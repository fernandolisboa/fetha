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
    expect(sessionReturns(100_000_00 as never, equityCurve)).toEqual([0, 0.01]);
  });

  it("includes the first session's own return, from initialCapital into the first equity point (round 2 item 13)", () => {
    const equityCurve = [point("2024-01-02", 110_000_00)];
    expect(sessionReturns(100_000_00 as never, equityCurve)).toEqual([0.1]);
  });

  it("skips a session whose predecessor's equity is zero rather than dividing by zero", () => {
    const equityCurve = [point("2024-01-02", 0), point("2024-01-03", 1_000_00)];
    expect(sessionReturns(0 as never, equityCurve)).toEqual([]);
  });

  it("skips every session whose predecessor's equity is negative rather than sign-flipping the return (round 2 item 13)", () => {
    // A recovery from −R$10,00 to −R$5,00 is a 50% improvement, not the
    // 50% loss the unsigned ratio of two negatives (500 / −1000) would
    // otherwise report; both negative-base sessions are skipped, and only
    // the session with a genuinely positive predecessor contributes.
    const equityCurve = [
      point("2024-01-02", -1_000),
      point("2024-01-03", -500),
      point("2024-01-04", 500_00),
      point("2024-01-05", 550_00),
    ];
    expect(sessionReturns(-2_000 as never, equityCurve)).toEqual([0.1]);
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

  it("never filters no_operation, less_than_one_effective_unit or no_risk_profile, which the run never emits (round 3 item 3)", () => {
    expect(surfacedNoteCodes).not.toContain("no_operation");
    expect(surfacedNoteCodes).not.toContain("less_than_one_effective_unit");
    expect(surfacedNoteCodes).not.toContain("no_risk_profile");
  });

  it("keeps a note whose code no panel already surfaces", () => {
    const run = runWithNotes([note("stale_price")]);
    expect(generalNotesFor(run)).toEqual([note("stale_price")]);
  });
});
