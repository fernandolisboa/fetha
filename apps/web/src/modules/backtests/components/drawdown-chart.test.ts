import { scaleLinear } from "@visx/scale";
import { describe, expect, it } from "vitest";
import type { EquityPoint } from "@fetha/engine";

import { drawdownDomain } from "./drawdown-chart";

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
