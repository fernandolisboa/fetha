import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { rsi } from "./rsi";

describe("Wilder RSI (New Concepts in Technical Trading Systems, 1978)", () => {
  it("is null until length changes are available, then follows Wilder's smoothed average gain/loss", () => {
    const closes = [44, 44.25, 44.5, 43.75, 44.65].map((n) => new Decimal(n));
    const length = 3;
    const result = rsi(closes, length);

    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();

    const avgGain3 = new Decimal("0.25").add("0.25").add("0").div(3);
    const avgLoss3 = new Decimal("0").add("0").add("0.75").div(3);
    const rsi3 = new Decimal(100).sub(
      new Decimal(100).div(new Decimal(1).add(avgGain3.div(avgLoss3))),
    );
    expect(result[3]?.toString()).toBe(rsi3.toString());

    const avgGain4 = avgGain3
      .mul(length - 1)
      .add("0.9")
      .div(length);
    const avgLoss4 = avgLoss3
      .mul(length - 1)
      .add("0")
      .div(length);
    const rsi4 = new Decimal(100).sub(
      new Decimal(100).div(new Decimal(1).add(avgGain4.div(avgLoss4))),
    );
    expect(result[4]?.toString()).toBe(rsi4.toString());
  });

  it("returns all nulls when there are length changes or fewer", () => {
    const closes = [1, 2, 3].map((n) => new Decimal(n));
    expect(rsi(closes, 3)).toEqual([null, null, null]);
  });

  it("is 100 when every change in the window is a gain (avgLoss = 0)", () => {
    const closes = [1, 2, 3, 4].map((n) => new Decimal(n));
    const result = rsi(closes, 3);
    expect(result[3]?.toString()).toBe("100");
  });

  it("matches the published RSI(14) reference series (StockCharts.org RSI ChartSchool example, also reproduced in anandanand84/technicalindicators test fixtures)", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35,
      44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13,
    ].map((n) => new Decimal(n));
    const result = rsi(closes, 14);
    const toTwoDp = (v: Decimal | null | undefined): string | null =>
      v ? v.toDecimalPlaces(2).toString() : null;
    expect(toTwoDp(result[14])).toBe("70.46");
    expect(toTwoDp(result[15])).toBe("66.25");
    expect(toTwoDp(result[16])).toBe("66.48");
  });
});
