import { describe, expect, it } from "vitest";

import { calendarMarkerSession, resolveSgsFromDate } from "./ingest";

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

describe("resolveSgsFromDate", () => {
  it("starts on the first calendar day itself when no macro point was ever ingested", () => {
    expect(resolveSgsFromDate(undefined)).toBe("2024-01-01");
  });

  it("resumes the day after the latest ingested macro point", () => {
    expect(resolveSgsFromDate("2026-06-14")).toBe("2026-06-15");
  });
});
