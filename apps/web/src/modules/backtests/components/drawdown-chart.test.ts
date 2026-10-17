import { scaleLinear } from "@visx/scale";
import { describe, expect, it } from "vitest";
import type { EquityPoint } from "@fetha/engine";

import { drawdownDomain, percentTick, percentTickDecimals } from "./drawdown-chart";

function point(session: string, drawdown: string): EquityPoint {
  return { session, equity: 0 as never, cash: 0 as never, drawdown: drawdown as never };
}

describe("drawdownDomain", () => {
  it("uses the run's deepest drawdown as the upper bound, not 0", () => {
    const points = [
      point("2024-01-02", "0"),
      point("2024-01-03", "0.12"),
      point("2024-01-04", "0.05"),
    ];
    expect(drawdownDomain(points)).toEqual([0, 0.12]);
  });

  it("renders a real 12% drawdown to a non-zero pixel position, not an empty [0,0] scale", () => {
    const points = [point("2024-01-02", "0"), point("2024-01-03", "0.12")];
    const [min, max] = drawdownDomain(points);
    expect(max).toBeGreaterThan(min);
    const yScale = scaleLinear<number>({ domain: [min, max], range: [0, 120] });
    expect(yScale(0.12)).toBeCloseTo(120, 5);
    expect(yScale(0)).toBeCloseTo(0, 5);
  });
});

describe("percentTick", () => {
  it("labels a 1.6% drawdown in half points, each label distinct", () => {
    const yScale = scaleLinear<number>({ domain: [0, 0.016], range: [0, 120], nice: true });
    const ticks = yScale.ticks(3);
    const labels = ticks.map((tick) => percentTick(-tick * 100, percentTickDecimals(ticks)));
    expect(labels).toEqual(["0,0%", "−0,5%", "−1,0%", "−1,5%"]);
  });

  it("keeps whole percents for a deep drawdown", () => {
    expect(percentTickDecimals([0, 0.1, 0.2])).toBe(0);
    expect(percentTick(-10, 0)).toBe("−10%");
  });
});
