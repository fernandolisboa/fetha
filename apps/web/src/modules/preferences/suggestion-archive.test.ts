import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  archiveAfterMinutes,
  durationMinutes,
  durationOf,
  MAX_ARCHIVE_MINUTES,
  storedSuggestionArchive,
  suggestionArchiveInputSchema,
} from "./suggestion-archive";

describe("suggestion archive delay (docs/adr/0074)", () => {
  it("speaks in the largest unit that divides the stored minutes", () => {
    expect(durationOf(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(durationOf(180)).toEqual({ amount: 3, unit: "hours" });
    expect(durationOf(1440)).toEqual({ amount: 1, unit: "days" });
    expect(durationOf(2 * 1440 + 60)).toEqual({ amount: 49, unit: "hours" });
    expect(durationOf(20160)).toEqual({ amount: 2, unit: "weeks" });
  });

  it("round-trips any stored minutes through what the screen shows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_ARCHIVE_MINUTES }), (minutes) => {
        expect(durationMinutes(durationOf(minutes))).toBe(minutes);
      }),
    );
  });

  it("takes a whole amount of at least one, up to a year", () => {
    expect(suggestionArchiveInputSchema.parse({ enabled: true, amount: 3, unit: "days" })).toEqual({
      enabled: true,
      afterMinutes: 4320,
    });
    expect(
      suggestionArchiveInputSchema.safeParse({ enabled: true, amount: 52, unit: "weeks" }).success,
    ).toBe(true);
    for (const amount of [0, -1, 1.5]) {
      expect(
        suggestionArchiveInputSchema.safeParse({ enabled: true, amount, unit: "hours" }).success,
      ).toBe(false);
    }
    expect(
      suggestionArchiveInputSchema.safeParse({ enabled: true, amount: 53, unit: "weeks" }).success,
    ).toBe(false);
    expect(
      suggestionArchiveInputSchema.safeParse({ enabled: true, amount: 1, unit: "months" }).success,
    ).toBe(false);
  });

  it("reads a stored delay out of range as one day, and off as no delay", () => {
    expect(storedSuggestionArchive(true, 0)).toEqual({ enabled: true, afterMinutes: 1440 });
    expect(archiveAfterMinutes({ enabled: false, afterMinutes: 60 })).toBeNull();
    expect(archiveAfterMinutes({ enabled: true, afterMinutes: 60 })).toBe(60);
  });
});
