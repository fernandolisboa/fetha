import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { clampLots, stepLots } from "./lot-step";
import { MAX_LOTS_SEARCHED } from "./sizing";

describe("clampLots", () => {
  it("never drops below one lot", () => {
    expect(clampLots(0)).toBe(1);
    expect(clampLots(-5)).toBe(1);
  });

  it("never exceeds the sizing cap", () => {
    expect(clampLots(MAX_LOTS_SEARCHED + 10)).toBe(MAX_LOTS_SEARCHED);
  });

  it("is a no-op within bounds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_LOTS_SEARCHED }), (lots) => {
        expect(clampLots(lots)).toBe(lots);
      }),
    );
  });
});

describe("stepLots", () => {
  it("increments and decrements within bounds", () => {
    expect(stepLots(3, 1)).toBe(4);
    expect(stepLots(3, -1)).toBe(2);
  });

  it("refuses to step below one lot", () => {
    expect(stepLots(1, -1)).toBe(1);
  });

  it("refuses to step above the sizing cap", () => {
    expect(stepLots(MAX_LOTS_SEARCHED, 1)).toBe(MAX_LOTS_SEARCHED);
  });
});
