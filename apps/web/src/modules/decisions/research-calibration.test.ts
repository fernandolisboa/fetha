import { describe, expect, it } from "vitest";

import { discardedOutcome, researchCalibration } from "./research-calibration";
import type { ResearchScoreRow } from "./research-scores-repository";

const row = (
  verdict: ResearchScoreRow["verdict"],
  claimHeld: boolean | null,
  pnlCentavos: number | null,
  unscorableReason: string | null = null,
): ResearchScoreRow => ({
  ideaId: crypto.randomUUID(),
  verdict,
  claimHeld,
  pnlCentavos,
  unscorableReason,
});

describe("researchCalibration", () => {
  it("counts, per verdict, the scored ideas, those with a judged claim, those that held and the average P&L per lot", () => {
    const lines = researchCalibration([
      row("enter", true, 10000),
      row("enter", false, -4000),
      row("enter", null, 500),
      row("wait", true, 300),
      row("do_not_enter", false, -7000),
    ]);
    expect(lines).toEqual([
      { verdict: "enter", scored: 3, unscorable: 0, claimed: 2, held: 1, averagePnl: 2167 },
      { verdict: "wait", scored: 1, unscorable: 0, claimed: 1, held: 1, averagePnl: 300 },
      {
        verdict: "do_not_enter",
        scored: 1,
        unscorable: 0,
        claimed: 1,
        held: 0,
        averagePnl: -7000,
      },
    ]);
  });

  it("counts an idea the engine could not score apart, and averages nothing over it", () => {
    const [enter] = researchCalibration([
      row("enter", null, null, "insufficient_data"),
      row("enter", true, 400),
    ]);
    expect(enter).toEqual({
      verdict: "enter",
      scored: 1,
      unscorable: 1,
      claimed: 1,
      held: 1,
      averagePnl: 400,
    });
    const [none] = researchCalibration([row("enter", null, null, "invalid_stored_idea")]);
    expect(none).toMatchObject({ scored: 0, unscorable: 1, averagePnl: null });
  });

  it("lists every verdict even with no rows", () => {
    expect(researchCalibration([]).map((line) => line.verdict)).toEqual([
      "enter",
      "wait",
      "do_not_enter",
    ]);
  });
});

describe("discardedOutcome", () => {
  it("is the same figure as the discarded verdict's row", () => {
    const calibration = researchCalibration([
      row("do_not_enter", true, 3000),
      row("do_not_enter", false, -1001),
    ]);
    const line = calibration.find((entry) => entry.verdict === "do_not_enter");
    expect(discardedOutcome(calibration)).toMatchObject({ amount: line?.averagePnl, sign: "gain" });
  });

  it("is null until a discarded idea is scored", () => {
    expect(discardedOutcome(researchCalibration([row("enter", true, 100)]))).toBeNull();
  });

  it("averages the discarded ideas' P&L per lot and names the sign", () => {
    expect(
      discardedOutcome(
        researchCalibration([row("do_not_enter", true, 3000), row("do_not_enter", true, 2001)]),
      ),
    ).toEqual({ count: 2, amount: 2501, sign: "gain" });
    expect(discardedOutcome(researchCalibration([row("do_not_enter", false, -4500)]))).toEqual({
      count: 1,
      amount: 4500,
      sign: "loss",
    });
    expect(discardedOutcome(researchCalibration([row("do_not_enter", true, 0)]))).toEqual({
      count: 1,
      amount: 0,
      sign: "flat",
    });
  });
});
