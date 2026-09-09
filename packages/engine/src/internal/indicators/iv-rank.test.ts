import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ivRank } from "./iv-rank";

describe("iv_rank: 0-100 percentile of the implied-volatility index over lookbackSessions", () => {
  it("is null while fewer than lookbackSessions points are visible", () => {
    const points = [10, 20].map((n) => new Decimal(n));
    expect(ivRank(points, 3)).toEqual([null, null]);
  });

  it("counts points strictly below the current one in a window of lookbackSessions (current included)", () => {
    const points = [10, 30, 20, 40].map((n) => new Decimal(n));
    const lookbackSessions = 3;
    const result = ivRank(points, lookbackSessions);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();

    // window [10, 30, 20], current 20: below = {10} -> 1
    expect(result[2]?.toString()).toBe(
      new Decimal(100)
        .mul(1)
        .div(lookbackSessions - 1)
        .toString(),
    );

    // window [30, 20, 40], current 40: below = {30, 20} -> 2
    expect(result[3]?.toString()).toBe(
      new Decimal(100)
        .mul(2)
        .div(lookbackSessions - 1)
        .toString(),
    );
  });

  it("is 0 when the current point is the lowest in the window", () => {
    const points = [50, 40, 30].map((n) => new Decimal(n));
    expect(ivRank(points, 3)[2]?.toString()).toBe("0");
  });

  it("is 100 when the current point is strictly above every other point in the window", () => {
    const points = [10, 20, 30].map((n) => new Decimal(n));
    expect(ivRank(points, 3)[2]?.toString()).toBe("100");
  });
});
