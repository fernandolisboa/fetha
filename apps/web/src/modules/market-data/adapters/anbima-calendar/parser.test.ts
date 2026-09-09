import { describe, expect, it } from "vitest";

import {
  CalendarValidationError,
  buildTradingSessions,
  holidaysForYear,
  parseHolidaysFile,
} from "./parser";
import type { Holiday } from "./schema";

const sampleHolidays: Holiday[] = [
  { date: "2026-01-01", name: "Confraternização Universal" },
  { date: "2026-02-16", name: "Carnaval" },
  { date: "2026-02-17", name: "Carnaval" },
  { date: "2026-04-03", name: "Paixão de Cristo" },
  { date: "2026-04-21", name: "Tiradentes" },
  { date: "2026-09-07", name: "Independência" },
  { date: "2026-11-02", name: "Finados" },
  { date: "2026-11-15", name: "Proclamação da República" },
  { date: "2026-12-25", name: "Natal" },
];

describe("parseHolidaysFile", () => {
  it("validates the committed holiday list shape", () => {
    expect(parseHolidaysFile(sampleHolidays)).toEqual(sampleHolidays);
  });

  it("rejects a malformed entry", () => {
    expect(() => parseHolidaysFile([{ date: "not-a-date", name: "x" }])).toThrow();
  });
});

describe("holidaysForYear", () => {
  it("filters to the year and adds B3's Dec 24/31 closures", () => {
    const holidays = holidaysForYear(sampleHolidays, 2026);
    expect(holidays).toContain("2026-01-01");
    expect(holidays).toContain("2026-12-24");
    expect(holidays).toContain("2026-12-31");
    expect(holidays).toHaveLength(11);
  });

  it("throws when a year has fewer than 8 ANBIMA holidays", () => {
    const thin = sampleHolidays.filter((h) => h.date < "2026-09-01");
    expect(() => holidaysForYear(thin, 2026)).toThrow(CalendarValidationError);
  });
});

describe("buildTradingSessions", () => {
  it("excludes weekends and holidays, with open 13:00Z and close 20:00Z", () => {
    const holidays = holidaysForYear(sampleHolidays, 2026);
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

  it("excludes Dec 24 and Dec 31 as B3 closures even though ANBIMA does not list them", () => {
    const holidays = holidaysForYear(sampleHolidays, 2026);
    const sessions = buildTradingSessions(2026, holidays);
    expect(sessions.some((session) => session.date === "2026-12-24")).toBe(false);
    expect(sessions.some((session) => session.date === "2026-12-31")).toBe(false);
  });

  it("does not include a holiday that falls on a weekend twice", () => {
    const holidays = holidaysForYear(sampleHolidays, 2026);
    const sessions = buildTradingSessions(2026, holidays);
    const republicDay = sessions.find((session) => session.date === "2026-11-15");
    expect(republicDay).toBeUndefined();
  });
});
