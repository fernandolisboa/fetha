import { describe, expect, it } from "vitest";

import { nearestBullCallSpread } from "./e2e-seed";

const call = (expiry: string, strike: string) => ({ right: "call" as const, expiry, strike });

describe("nearestBullCallSpread", () => {
  it("buys the first strike at or above the close and sells the next one on the nearest expiry", () => {
    const spread = nearestBullCallSpread(
      [call("2026-10-23", "58.00"), call("2026-10-23", "59.00"), call("2026-10-23", "60.00")],
      58.21,
      "2026-10-20",
    );
    expect(spread?.bought.strike).toBe("59.00");
    expect(spread?.sold.strike).toBe("60.00");
  });

  it("moves to a later expiry when the nearest ladder stops below the close", () => {
    const spread = nearestBullCallSpread(
      [
        call("2026-10-23", "57.86"),
        call("2026-10-23", "58.86"),
        call("2026-11-19", "58.00"),
        call("2026-11-19", "60.00"),
        call("2026-11-19", "62.00"),
      ],
      58.21,
      "2026-10-20",
    );
    expect(spread?.bought).toEqual(call("2026-11-19", "60.00"));
    expect(spread?.sold).toEqual(call("2026-11-19", "62.00"));
  });

  it("ignores expiries on or before the session and finds nothing without two strikes above", () => {
    expect(
      nearestBullCallSpread(
        [call("2026-10-20", "59.00"), call("2026-10-20", "60.00"), call("2026-10-23", "59.00")],
        58.21,
        "2026-10-20",
      ),
    ).toBeNull();
  });
});
