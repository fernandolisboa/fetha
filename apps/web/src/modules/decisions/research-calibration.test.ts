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
  it("counts, per verdict, the scored ideas, those with a judged claim, those that held and the summed P&L", () => {
    const lines = researchCalibration([
      row("enter", true, 10000),
      row("enter", false, -4000),
      row("enter", null, 500),
      row("wait", true, 300),
      row("do_not_enter", false, -7000),
    ]);
    expect(lines).toEqual([
      { verdict: "enter", scored: 3, claimed: 2, held: 1, pnl: 6500 },
      { verdict: "wait", scored: 1, claimed: 1, held: 1, pnl: 300 },
      { verdict: "do_not_enter", scored: 1, claimed: 1, held: 0, pnl: -7000 },
    ]);
  });

  it("counts nothing for an idea the engine could not score", () => {
    const [enter] = researchCalibration([row("enter", null, null, "insufficient_data")]);
    expect(enter).toEqual({ verdict: "enter", scored: 0, claimed: 0, held: 0, pnl: 0 });
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
