import { describe, expect, it } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  type Centavos,
  type DecimalString,
} from "@fetha/contracts";
import type { PayoffPoint } from "@fetha/engine";

import {
  buildPayoffSparkline,
  PAYOFF_SPARK_VIEW_HEIGHT,
  PAYOFF_SPARK_VIEW_WIDTH,
} from "./payoff-sparkline";

function dec(value: string): DecimalString {
  return decimalStringSchema.parse(value);
}

function cents(value: number): Centavos {
  return centavosSchema.parse(value);
}

function point(underlying: string, pnl: number): PayoffPoint {
  return { underlying: dec(underlying), pnl: cents(pnl) };
}

describe("buildPayoffSparkline", () => {
  it("returns null for fewer than two points", () => {
    expect(buildPayoffSparkline([])).toBeNull();
    expect(buildPayoffSparkline([point("9.00", 0)])).toBeNull();
  });

  it("draws the zero line within the viewBox for a curve that both gains and loses", () => {
    const payoff = [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)];
    const spark = buildPayoffSparkline(payoff);

    expect(spark).not.toBeNull();
    expect(spark?.zeroY).toBeGreaterThan(0);
    expect(spark?.zeroY).toBeLessThan(PAYOFF_SPARK_VIEW_HEIGHT);
    expect(spark?.linePath.startsWith("M")).toBe(true);
    expect(spark?.upAreaPath.startsWith("M")).toBe(true);
    expect(spark?.downAreaPath.startsWith("M")).toBe(true);
  });

  it("places the zero line at the bottom when the whole curve is a gain", () => {
    const payoff = [point("30.00", 100), point("36.62", 100), point("45.00", 13800)];
    const spark = buildPayoffSparkline(payoff);

    expect(spark?.zeroY).toBeCloseTo(PAYOFF_SPARK_VIEW_HEIGHT - 2, 0);
  });

  it("places the zero line at the top when the whole curve is a loss", () => {
    const payoff = [point("30.00", -100), point("36.62", -100), point("45.00", -13800)];
    const spark = buildPayoffSparkline(payoff);

    expect(spark?.zeroY).toBeCloseTo(2, 0);
  });

  it("centers the zero line when the curve never moves away from zero", () => {
    const payoff = [point("30.00", 0), point("36.62", 0)];
    const spark = buildPayoffSparkline(payoff);

    expect(spark?.zeroY).toBeCloseTo(PAYOFF_SPARK_VIEW_HEIGHT / 2, 5);
  });

  it("places a middle sample by its own underlying price, not by its index among unevenly spaced samples", () => {
    // 8.00, 9.28 and 20.00: the middle sample sits near the low end of the price range, far from
    // the midpoint an index-based x would put it at.
    const payoff = [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)];
    const spark = buildPayoffSparkline(payoff);
    const coordinates = spark?.linePath.match(/[ML]([\d.]+),/g)?.map((m) => Number(m.slice(1, -1)));

    expect(coordinates).toHaveLength(3);
    const [firstX, middleX, lastX] = coordinates ?? [];
    const padding = 2;
    expect(firstX).toBeCloseTo(padding, 2);
    expect(lastX).toBeCloseTo(PAYOFF_SPARK_VIEW_WIDTH - padding, 2);
    // By underlying price: (9.28 - 8.00) / (20.00 - 8.00) = 0.10666...
    const expectedMiddleX = padding + (1.28 / 12) * (PAYOFF_SPARK_VIEW_WIDTH - 2 * padding);
    expect(middleX).toBeCloseTo(expectedMiddleX, 1);
    // An index-based x would have placed it at the midpoint instead.
    expect(middleX).not.toBeCloseTo(PAYOFF_SPARK_VIEW_WIDTH / 2, 0);
  });

  it("spans the full fixed viewBox width regardless of the number of points", () => {
    const payoff = [point("8.00", -1100), point("9.28", 3900), point("20.00", -100)];
    const spark = buildPayoffSparkline(payoff);
    const lastCoordinate = spark?.linePath.split("L").at(-1);

    expect(lastCoordinate?.startsWith((PAYOFF_SPARK_VIEW_WIDTH - 2).toFixed(2))).toBe(true);
  });
});
