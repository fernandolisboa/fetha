import { describe, expect, it } from "vitest";

import { buildBins } from "./distribution-chart";

describe("buildBins", () => {
  it("keys every bin by a unique id, even when whole-percent labels would collide", () => {
    // Ten per-operation returns clustered tightly enough that rounding to
    // whole percent would label most bins "0%": the bug this guards.
    const returns = [
      0.001, 0.002, -0.001, 0.0015, -0.0005, 0.0009, -0.0012, 0.0003, 0.0007, -0.0002,
    ];
    const bins = buildBins(returns);
    const ids = bins.map((bin) => bin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("distributes ten tightly-clustered returns across distinct bins instead of one overpainted bar", () => {
    const returns = [
      0.001, 0.002, -0.001, 0.0015, -0.0005, 0.0009, -0.0012, 0.0003, 0.0007, -0.0002,
    ];
    const bins = buildBins(returns);
    const occupied = bins.filter((bin) => bin.count > 0);
    expect(occupied.length).toBeGreaterThan(1);
  });

  it("scales label precision with a sub-1% bin width so neighbouring bins get distinct labels (round 2 item 14)", () => {
    const returns = [
      0.0001, 0.0002, -0.0001, 0.00015, -0.00005, 0.00009, -0.00012, 0.00003, 0.00007, -0.00002,
    ];
    const bins = buildBins(returns);
    const labels = bins.map((bin) => bin.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("never renders a signed zero label, even for a bin whose lower edge rounds to zero (round 2 item 14)", () => {
    const returns = [
      0.0001, 0.0002, -0.0001, 0.00015, -0.00005, 0.00009, -0.00012, 0.00003, 0.00007, -0.00002,
    ];
    const bins = buildBins(returns);
    const signedZero = /^−0(,0+)?%$/;
    for (const bin of bins) {
      expect(signedZero.test(bin.label)).toBe(false);
    }
  });

  it("uses the pt-BR comma decimal separator, matching the rest of the report, not toFixed's dot (round 3 item 12)", () => {
    const returns = [0.01, 0.02, -0.01, 0.015, -0.005, 0.009, -0.012, 0.003, 0.007, -0.002];
    const bins = buildBins(returns);
    for (const bin of bins) {
      expect(bin.label).not.toContain(".");
    }
    expect(bins.some((bin) => bin.label.includes(","))).toBe(true);
  });
});
