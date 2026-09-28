import { describe, expect, it } from "vitest";

import { drizzleQueryError, postgresError } from "@/db/test/pg-error";

import {
  calendarMarkerSession,
  dayOffsetForClosures,
  ingestionErrorMessage,
  resolveSgsFromDate,
} from "./ingest";

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

describe("ingestionErrorMessage", () => {
  it("reduces a drizzle-wrapped Postgres error to its code", () => {
    const error = drizzleQueryError(postgresError("23505"));

    expect(ingestionErrorMessage(error)).toBe("23505");
  });

  it("includes the violated constraint alongside the code when the driver reports one", () => {
    const error = drizzleQueryError(postgresError("23514", { constraint: "check_positive" }));

    expect(ingestionErrorMessage(error)).toBe("23514 (check_positive)");
  });

  it("never leaks the SQL statement or bound params of a drizzle query failure", () => {
    const error = drizzleQueryError(postgresError("57014"));

    const message = ingestionErrorMessage(error);

    expect(message).not.toContain("Failed query");
    expect(message).not.toContain("params:");
  });

  it("falls back to a generic message for a drizzle query failure with no Postgres-shaped cause", () => {
    const error = drizzleQueryError(new Error("connection reset"));

    const message = ingestionErrorMessage(error);

    expect(message).toBe("database query failed");
    expect(message).not.toContain("Failed query");
  });

  it("truncates a plain error's message instead of dropping it", () => {
    const error = new Error("a".repeat(500));

    const message = ingestionErrorMessage(error);

    expect(message.length).toBeLessThan(500);
    expect(message.startsWith("a".repeat(200))).toBe(true);
  });

  it("keeps a short plain error message intact", () => {
    expect(ingestionErrorMessage(new Error("no trading session recorded for 2026-06-15"))).toBe(
      "no trading session recorded for 2026-06-15",
    );
  });

  it("reports unknown error for a non-Error thrown value", () => {
    expect(ingestionErrorMessage("boom")).toBe("unknown error");
    expect(ingestionErrorMessage(undefined)).toBe("unknown error");
  });

  it("reports unknown error for an Error with an empty message instead of an empty string", () => {
    expect(ingestionErrorMessage(new Error(""))).toBe("unknown error");
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
