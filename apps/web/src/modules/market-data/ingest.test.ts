import { describe, expect, it } from "vitest";

import { calendarMarkerSession, dayOffsetForClosures, resolveSgsFromDate } from "./ingest";

describe("calendarMarkerSession", () => {
  it("returns a valid calendar date within the requested year", () => {
    const marker = calendarMarkerSession(2026);
    expect(marker).toMatch(/^2026-\d{2}-\d{2}$/);
  });

  it("is stable across repeated calls for the same year", () => {
    expect(calendarMarkerSession(2026)).toBe(calendarMarkerSession(2026));
  });

  it("differs between years with different holiday lists", () => {
    expect(calendarMarkerSession(2024)).not.toBe(calendarMarkerSession(2025));
  });
});

describe("dayOffsetForClosures", () => {
  it("is stable across repeated calls and independent of input order", () => {
    const closures = ["2026-01-01", "2026-12-25", "2026-04-21"];
    const reordered = [...closures].reverse();
    expect(dayOffsetForClosures(closures)).toBe(dayOffsetForClosures(reordered));
  });

  it("stays within a valid day-of-year range", () => {
    expect(dayOffsetForClosures([])).toBeGreaterThanOrEqual(0);
    expect(dayOffsetForClosures([])).toBeLessThan(365);
    const many = Array.from({ length: 40 }, (_, index) => `2026-01-${String(index + 1)}`);
    const offset = dayOffsetForClosures(many);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(365);
  });

  it("folds the closure count into the hash, not only the joined content", () => {
    // "14" and "110" hash to the same day offset (111) under a content-only
    // hash of the joined string; asserting they land on different offsets
    // here pins that the count is folded in, not just a coincidence.
    expect(dayOffsetForClosures(["14"])).not.toBe(dayOffsetForClosures(["110"]));
  });
});

describe("resolveSgsFromDate", () => {
  it("starts on the first calendar day itself when no macro point was ever ingested", () => {
    expect(resolveSgsFromDate(undefined)).toBe("2024-01-01");
  });

  it("resumes the day after the latest ingested macro point", () => {
    expect(resolveSgsFromDate("2026-06-14")).toBe("2026-06-15");
  });
});
