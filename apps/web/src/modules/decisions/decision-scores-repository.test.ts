import { describe, expect, it } from "vitest";

import { computeTrackRecordStats } from "./decision-scores-repository";

function claimRow(confidence: string, held: boolean) {
  return {
    claimHeld: held,
    brier: "0.1",
    normalizedPnl: null,
    unscorableReason: null,
    horizon: "2026-09-09",
    confidence,
    kind: "enter",
  };
}

// #29 fix-web item 7 (quant+correctness BLOCKING): bucketed on the integer
// percent, not the raw decimal fraction, so a floating-point artifact like
// `0.59999999999999998` (a real `Number(decimalString)` result) still lands
// in the "60-80%" bucket its rounded percent belongs to, not "40-60%".
describe("confidence bucketing (computeTrackRecordStats)", () => {
  const cases: [string, string][] = [
    ["0.00", "0-20%"],
    ["0.05", "0-20%"],
    ["0.10", "0-20%"],
    ["0.15", "0-20%"],
    ["0.20", "20-40%"],
    ["0.25", "20-40%"],
    ["0.30", "20-40%"],
    ["0.35", "20-40%"],
    ["0.40", "40-60%"],
    ["0.45", "40-60%"],
    ["0.50", "40-60%"],
    ["0.55", "40-60%"],
    ["0.60", "60-80%"],
    ["0.65", "60-80%"],
    ["0.70", "60-80%"],
    ["0.75", "60-80%"],
    ["0.80", "80-100%"],
    ["0.85", "80-100%"],
    ["0.90", "80-100%"],
    ["0.95", "80-100%"],
    ["1.00", "80-100%"],
  ];

  it.each(cases)("buckets confidence %s into %s", (confidence, expectedBucket) => {
    const stats = computeTrackRecordStats([claimRow(confidence, true)]);
    expect(stats.confidenceBuckets).toEqual([{ bucket: expectedBucket, count: 1, heldCount: 1 }]);
  });

  it("0.6 buckets as 60-80%, not 40-60% (the ticket's own example)", () => {
    const stats = computeTrackRecordStats([claimRow("0.6", false)]);
    expect(stats.confidenceBuckets).toEqual([{ bucket: "60-80%", count: 1, heldCount: 0 }]);
  });

  it("clamps a 100% confidence into the top 80-100% bucket rather than opening a 100-120% one", () => {
    const stats = computeTrackRecordStats([claimRow("1", true)]);
    expect(stats.confidenceBuckets).toEqual([{ bucket: "80-100%", count: 1, heldCount: 1 }]);
  });

  it("survives a floating-point artifact just below an integer-percent boundary", () => {
    const stats = computeTrackRecordStats([claimRow("0.59999999999999998", true)]);
    expect(stats.confidenceBuckets).toEqual([{ bucket: "60-80%", count: 1, heldCount: 1 }]);
  });

  it("excludes unscorable rows from every aggregate", () => {
    const stats = computeTrackRecordStats([
      { ...claimRow("0.7", true), unscorableReason: "insufficient_data" },
    ]);
    expect(stats).toMatchObject({ scoredCount: 0, claimsScoredCount: 0, confidenceBuckets: [] });
  });

  it("excludes do_not_enter decisions from pnlOverTime but not from hit rate", () => {
    const stats = computeTrackRecordStats([
      { ...claimRow("0.7", true), normalizedPnl: "0.2", kind: "do_not_enter" },
      { ...claimRow("0.7", true), normalizedPnl: "0.1", kind: "enter" },
    ]);
    expect(stats.claimsScoredCount).toBe(2);
    expect(stats.pnlOverTime).toEqual([{ horizon: "2026-09-09", normalizedPnl: "0.1" }]);
  });
});
