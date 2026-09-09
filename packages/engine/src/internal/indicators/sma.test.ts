import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { sma } from "./sma";

describe("sma: arithmetic mean of the last length closes", () => {
  it("is null during warm-up and the mean of the trailing window after", () => {
    const closes = [1, 2, 3, 4, 5].map((n) => new Decimal(n));
    const result = sma(closes, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]?.toString()).toBe("2");
    expect(result[3]?.toString()).toBe("3");
    expect(result[4]?.toString()).toBe("4");
  });

  it("matches a hand-computed 3-period SMA example", () => {
    const closes = [10, 11, 12, 13, 14, 20].map((n) => new Decimal(n));
    const result = sma(closes, 3);
    expect(result.map((v) => v?.toString() ?? null)).toEqual([
      null,
      null,
      "11",
      "12",
      "13",
      new Decimal(13 + 14 + 20).div(3).toString(),
    ]);
  });

  it("returns all nulls when there are fewer candles than length", () => {
    const closes = [1, 2].map((n) => new Decimal(n));
    expect(sma(closes, 3)).toEqual([null, null]);
  });
});
