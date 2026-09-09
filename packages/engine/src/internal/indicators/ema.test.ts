import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ema } from "./ema";

describe("ema: seeded with the SMA of the first length candles", () => {
  it("is null during warm-up, seeds at length-1 with the SMA, then smooths with k = 2/(length+1)", () => {
    const c0 = new Decimal(22);
    const c1 = new Decimal(23);
    const c2 = new Decimal(24);
    const c3 = new Decimal(25);
    const c4 = new Decimal(26);
    const closes = [c0, c1, c2, c3, c4];
    const length = 3;
    const result = ema(closes, length);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();

    const seed = c0.add(c1).add(c2).div(3);
    expect(result[2]?.toString()).toBe(seed.toString());

    const k = new Decimal(2).div(length + 1);
    const e3 = c3.sub(seed).mul(k).add(seed);
    expect(result[3]?.toString()).toBe(e3.toString());

    const e4 = c4.sub(e3).mul(k).add(e3);
    expect(result[4]?.toString()).toBe(e4.toString());
  });

  it("returns all nulls when there are fewer candles than length", () => {
    const closes = [1, 2].map((n) => new Decimal(n));
    expect(ema(closes, 3)).toEqual([null, null]);
  });
});
