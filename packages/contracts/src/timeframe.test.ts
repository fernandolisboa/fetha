import { describe, expect, it } from "vitest";
import { timeframeSchema, timeframes } from "./timeframe";

describe("timeframeSchema", () => {
  it("accepts every timeframe of the closed vocabulary", () => {
    expect(timeframes).toEqual(["15m", "30m", "60m", "D1"]);
    for (const timeframe of timeframes) {
      expect(timeframeSchema.parse(timeframe)).toBe(timeframe);
    }
  });

  it.each(["1m", "5m", "1h", "W1", "d1", ""])("rejects %s", (value) => {
    expect(timeframeSchema.safeParse(value).success).toBe(false);
  });
});
