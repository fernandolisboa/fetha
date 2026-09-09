import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildTradingSessions, parseHolidays } from "./parser";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "holidays-sample.csv"),
  "utf-8",
);

describe("parseHolidays", () => {
  it("parses the Data column as ISO dates", () => {
    const holidays = parseHolidays(fixture);
    expect(holidays).toContain("2026-01-01");
    expect(holidays).toContain("2026-09-07");
    expect(holidays).toHaveLength(8);
  });
});

describe("buildTradingSessions", () => {
  it("excludes weekends and holidays, with open 13:00Z and close 20:00Z", () => {
    const holidays = parseHolidays(fixture);
    const sessions = buildTradingSessions(2026, holidays);

    expect(sessions.some((session) => session.date === "2026-01-01")).toBe(false);
    expect(sessions.some((session) => session.date === "2026-09-07")).toBe(false);
    const saturday = sessions.find((session) => session.date === "2026-09-05");
    expect(saturday).toBeUndefined();

    const regularSession = sessions.find((session) => session.date === "2026-09-08");
    expect(regularSession).toEqual({
      date: "2026-09-08",
      open: "2026-09-08T13:00:00.000Z",
      close: "2026-09-08T20:00:00.000Z",
    });
  });

  it("does not include a holiday that falls on a weekend twice", () => {
    const holidays = parseHolidays(fixture);
    const sessions = buildTradingSessions(2026, holidays);
    const republicDay = sessions.find((session) => session.date === "2026-11-15");
    expect(republicDay).toBeUndefined();
  });
});
