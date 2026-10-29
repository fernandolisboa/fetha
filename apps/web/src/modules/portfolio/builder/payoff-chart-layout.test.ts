import { describe, expect, it } from "vitest";

import {
  focusWindow,
  formatAxisPrice,
  guideLabelY,
  guideVisible,
  nearestIndex,
  pnlAt,
  staggeredBelow,
} from "./payoff-chart-layout";

describe("formatAxisPrice", () => {
  it("prints pt-BR decimals without trailing zeros", () => {
    expect(formatAxisPrice(22.5)).toBe("22,5");
    expect(formatAxisPrice(20)).toBe("20");
    expect(formatAxisPrice(1234.567)).toBe("1.234,57");
  });
});

describe("nearestIndex", () => {
  const xs = [18.34, 21.58, 22.62, 23.08, 24.08];

  it("snaps to the engine sample closest to the pointer", () => {
    expect(nearestIndex(xs, 22.9)).toBe(3);
    expect(nearestIndex(xs, 22.7)).toBe(2);
  });

  it("snaps to the ends outside the sampled range", () => {
    expect(nearestIndex(xs, 5)).toBe(0);
    expect(nearestIndex(xs, 99)).toBe(4);
  });

  it("has nothing to snap to without samples", () => {
    expect(nearestIndex([], 10)).toBeNull();
  });
});

describe("staggeredBelow", () => {
  it("keeps labels far apart above the line", () => {
    expect(staggeredBelow([10, 100, 200], 40)).toEqual([false, false, false]);
  });

  it("drops a crowded label below, then the next crowded one back above", () => {
    expect(staggeredBelow([10, 30, 50], 40)).toEqual([false, true, false]);
  });

  it("puts a label above again once it clears the one before", () => {
    expect(staggeredBelow([10, 30, 120], 40)).toEqual([false, true, false]);
  });
});

describe("guideVisible", () => {
  it("draws a guide inside the plotted range", () => {
    expect(guideVisible(4600, 10400)).toBe(true);
    expect(guideVisible(-10400, 10400)).toBe(true);
  });

  it("skips a guide past the plotted range or on the zero line", () => {
    expect(guideVisible(-250000, 50000)).toBe(false);
    expect(guideVisible(0, 10400)).toBe(false);
  });
});

describe("guideLabelY", () => {
  it("writes a gain above its line and a loss below it", () => {
    expect(guideLabelY(100, "gain", 200, 12)).toBe(96);
    expect(guideLabelY(100, "loss", 200, 12)).toBe(112);
  });

  it("flips a label that would leave the plot", () => {
    expect(guideLabelY(0, "gain", 200, 12)).toBe(12);
    expect(guideLabelY(200, "loss", 200, 12)).toBe(196);
  });
});

// A PETR4 bull call spread two sessions from expiry: strikes 52,86/53,86, spot 52,79, break-even
// 53,31, sampled by the engine from 0.8x to 1.2x of spot.
const spread = [
  { underlying: 42.232, pnl: -4500 },
  { underlying: 52.79, pnl: -4500 },
  { underlying: 52.86, pnl: -4500 },
  { underlying: 53.31, pnl: 0 },
  { underlying: 53.86, pnl: 5500 },
  { underlying: 63.348, pnl: 5500 },
];

describe("focusWindow", () => {
  it("frames the strikes, break-even and spot with at least 5% of spot each side", () => {
    const [low, high] = focusWindow(spread, 52.79, [53.31]);
    expect(low).toBeCloseTo(52.79 - 52.79 * 0.05, 6);
    expect(high).toBeCloseTo(53.86 + 52.79 * 0.05, 6);
  });

  it("widens the margin to three quarters of a wide structure's span", () => {
    const butterfly = [
      { underlying: 10, pnl: -100 },
      { underlying: 20, pnl: -100 },
      { underlying: 25, pnl: 400 },
      { underlying: 30, pnl: -100 },
      { underlying: 40, pnl: -100 },
    ];
    expect(focusWindow(butterfly, 25, [21, 29])).toEqual([12.5, 37.5]);
  });

  it("never leaves the sampled range", () => {
    const longCall = [
      { underlying: 9.9, pnl: -50 },
      { underlying: 10, pnl: -50 },
      { underlying: 10.1, pnl: -40 },
    ];
    expect(focusWindow(longCall, 10, [])).toEqual([9.9, 10.1]);
  });
});

describe("pnlAt", () => {
  it("reads the line between two engine samples", () => {
    expect(pnlAt(spread, 53.585)).toBeCloseTo(2750, 6);
  });

  it("holds the end values outside the samples", () => {
    expect(pnlAt(spread, 10)).toBe(-4500);
    expect(pnlAt(spread, 99)).toBe(5500);
  });
});
