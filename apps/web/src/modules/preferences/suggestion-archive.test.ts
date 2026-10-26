import { describe, expect, it } from "vitest";

import {
  archiveAfterHours,
  suggestionArchiveDelay,
  suggestionArchiveDelays,
} from "./suggestion-archive";

describe("suggestion archive delay", () => {
  it("round-trips every option through the stored hours", () => {
    for (const delay of suggestionArchiveDelays) {
      expect(suggestionArchiveDelay(archiveAfterHours(delay))).toBe(delay);
    }
  });

  it("stores off as no hours", () => {
    expect(archiveAfterHours("off")).toBeNull();
    expect(archiveAfterHours("24")).toBe(24);
  });

  it("reads a stored value that is no longer an option as off", () => {
    expect(suggestionArchiveDelay(5)).toBe("off");
  });
});
