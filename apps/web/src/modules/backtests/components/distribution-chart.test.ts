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
});
