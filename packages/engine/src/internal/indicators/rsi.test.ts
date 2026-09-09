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
});
