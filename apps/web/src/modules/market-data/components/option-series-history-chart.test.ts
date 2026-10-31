import { describe, expect, it } from "vitest";
import { decimalStringSchema } from "@fetha/contracts";

import {
  axisLeftMargin,
  definedValues,
  formatPriceTick,
  formatVolatilityTick,
  isolatedIndexes,
  nearestIndex,
  toPlotPoints,
  yDomain,
  yTicks,
} from "./option-series-history-chart";

const price = (value: string) => decimalStringSchema.parse(value);

describe("toPlotPoints", () => {
  it("keeps a missing value as null and parses the rest", () => {
    const points = toPlotPoints(
      [
        { session: "2026-03-02", close: price("1.250000") },
        { session: "2026-03-03", close: null },
      ],
      (point) => point.close,
    );

    expect(points).toEqual([
      { session: "2026-03-02", value: 1.25 },
      { session: "2026-03-03", value: null },
    ]);
    expect(definedValues(points)).toEqual([1.25]);
  });
});

describe("yDomain", () => {
  it("frames the data with a margin instead of anchoring at zero", () => {
    const [low, high] = yDomain([10, 20]);

    expect(low).toBeCloseTo(9.2);
    expect(high).toBeCloseTo(20.8);
  });

  it("gives a flat series a band so it still draws a line", () => {
    const [low, high] = yDomain([2, 2]);

    expect(low).toBeLessThan(2);
    expect(high).toBeGreaterThan(2);
  });

  it("gives a flat zero series a band too", () => {
    expect(yDomain([0])).toEqual([-1, 1]);
  });
});

describe("axisLeftMargin", () => {
  it("fits the widest tick label at 7px a character plus the gap", () => {
    expect(axisLeftMargin(["R$ 1,2", "R$ 12,50"])).toBe(8 * 7 + 12);
  });

  it("stays at the gap when there is no label", () => {
    expect(axisLeftMargin([])).toBe(12);
  });
});

describe("yTicks", () => {
  it("returns round tick values inside the framed domain", () => {
    const ticks = yTicks([0.2, 0.8], 100);

    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBeGreaterThanOrEqual(0);
    expect(ticks.at(-1)).toBeLessThanOrEqual(1);
  });
});

describe("formatters", () => {
  it("prints prices in reais and volatility as a percentage, pt-BR", () => {
    expect(formatPriceTick(1.234)).toBe("R$ 1,23");
    expect(formatVolatilityTick(0.325)).toBe("32,5%");
  });
});

describe("nearestIndex", () => {
  it("snaps a pointer position to the nearest session", () => {
    expect(nearestIndex(0, 100, 5)).toBe(0);
    expect(nearestIndex(26, 100, 5)).toBe(1);
    expect(nearestIndex(100, 100, 5)).toBe(4);
  });

  it("clamps a pointer outside the plot", () => {
    expect(nearestIndex(-20, 100, 5)).toBe(0);
    expect(nearestIndex(500, 100, 5)).toBe(4);
  });

  it("is 0 with a single session or no width", () => {
    expect(nearestIndex(40, 100, 1)).toBe(0);
    expect(nearestIndex(40, 0, 5)).toBe(0);
  });
});

describe("isolatedIndexes", () => {
  it("finds the points that no line segment reaches", () => {
    const points = [1, null, 2, 3, null, 4].map((value, index) => ({
      session: String(index),
      value,
    }));

    expect(isolatedIndexes(points)).toEqual([0, 5]);
  });
});
