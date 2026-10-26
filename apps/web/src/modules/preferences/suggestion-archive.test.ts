import { describe, expect, it } from "vitest";

import { hoursFromDelay, delayFromHours, suggestionArchiveDelays } from "./suggestion-archive";

describe("suggestion archive delay", () => {
  it("round-trips every option through the stored hours", () => {
    for (const delay of suggestionArchiveDelays) {
      expect(delayFromHours(hoursFromDelay(delay))).toBe(delay);
    }
  });

  it("stores off as no hours", () => {
    expect(hoursFromDelay("off")).toBeNull();
    expect(hoursFromDelay("24")).toBe(24);
  });

  it("reads a stored value that is no longer an option as off", () => {
    expect(delayFromHours(5)).toBe("off");
  });
});
