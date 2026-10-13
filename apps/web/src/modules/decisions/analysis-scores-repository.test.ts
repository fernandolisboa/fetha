import { describe, expect, it } from "vitest";

import { computeAnalysisTrackRecordStats } from "./analysis-scores-repository";

describe("computeAnalysisTrackRecordStats", () => {
  it("is empty with no scored outlook, ignoring unscorable rows", () => {
    expect(
      computeAnalysisTrackRecordStats([
        { claimHeld: null, brier: null, likelihood: "somewhat_likely" },
      ]),
    ).toEqual({ scoredCount: 0, claimsHeldCount: 0, meanBrier: null, likelihoodBuckets: [] });
  });

  it("aggregates hit rate, mean Brier and one bucket per stated likelihood", () => {
    expect(
      computeAnalysisTrackRecordStats([
        { claimHeld: true, brier: "0.16", likelihood: "somewhat_likely" },
        { claimHeld: false, brier: "0.5625", likelihood: "likely" },
        { claimHeld: true, brier: "0.0625", likelihood: "likely" },
        { claimHeld: true, brier: "0.01", likelihood: "very_likely" },
      ]),
    ).toEqual({
      scoredCount: 4,
      claimsHeldCount: 3,
      meanBrier: "0.1988",
      likelihoodBuckets: [
        { likelihood: "somewhat_likely", count: 1, heldCount: 1 },
        { likelihood: "likely", count: 2, heldCount: 1 },
        { likelihood: "very_likely", count: 1, heldCount: 1 },
      ],
    });
  });
});
