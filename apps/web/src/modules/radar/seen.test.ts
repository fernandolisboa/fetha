import { describe, expect, it } from "vitest";

import { countsAsSeen } from "./seen";

describe("countsAsSeen (docs/adr/0074)", () => {
  it("needs half of the card on screen", () => {
    expect(
      countsAsSeen({ intersectionRatio: 0.5, intersectionHeight: 150, viewportHeight: 800 }),
    ).toBe(true);
    expect(
      countsAsSeen({ intersectionRatio: 0.1, intersectionHeight: 30, viewportHeight: 800 }),
    ).toBe(false);
  });

  it("counts a card taller than two screens once it fills half the screen", () => {
    expect(
      countsAsSeen({ intersectionRatio: 0.3, intersectionHeight: 420, viewportHeight: 800 }),
    ).toBe(true);
    expect(
      countsAsSeen({ intersectionRatio: 0.2, intersectionHeight: 300, viewportHeight: 800 }),
    ).toBe(false);
  });

  it("never counts a card off screen or without a known viewport", () => {
    expect(countsAsSeen({ intersectionRatio: 0, intersectionHeight: 0, viewportHeight: 800 })).toBe(
      false,
    );
    expect(
      countsAsSeen({ intersectionRatio: 0.4, intersectionHeight: 900, viewportHeight: null }),
    ).toBe(false);
  });
});
