import { describe, expect, it } from "vitest";

import { DATE_TICK_SPACING, evenlySpaced, ticksThatFit } from "./chart-ticks";

describe("ticksThatFit", () => {
  it("keeps the two end ticks on a phone-width axis", () => {
    expect(ticksThatFit(180, DATE_TICK_SPACING, 6)).toBe(2);
  });

  it("caps a wide axis at the requested maximum", () => {
    expect(ticksThatFit(1200, DATE_TICK_SPACING, 6)).toBe(6);
  });

  it("adds a tick for every spacing that fits in between", () => {
    expect(ticksThatFit(300, DATE_TICK_SPACING, 6)).toBe(4);
  });
});

describe("evenlySpaced", () => {
  const sessions = Array.from({ length: 53 }, (_, index) => index);

  it("always keeps the first and the last value", () => {
    expect(evenlySpaced(sessions, 2)).toEqual([0, 52]);
  });

  it("spreads the ticks in between evenly", () => {
    expect(evenlySpaced(sessions, 5)).toEqual([0, 13, 26, 39, 52]);
  });

  it("never puts two labels closer than one step, even next to the last", () => {
    expect(evenlySpaced(sessions, 6)).toEqual([0, 11, 22, 33, 52]);
    expect(
      evenlySpaced(
        Array.from({ length: 10 }, (_, index) => index),
        7,
      ),
    ).toEqual([0, 2, 4, 6, 9]);
  });

  it("returns every value when there are fewer than asked for", () => {
    expect(evenlySpaced([1, 2, 3], 6)).toEqual([1, 2, 3]);
  });
});
