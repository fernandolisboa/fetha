import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  convertToAnnualRate,
  parseSgsResponse,
  resolveAsOfInstant,
  splitIntoTenYearWindows,
} from "./parser";

const cdiFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "sgs-cdi-sample.json"), "utf-8"),
);
const selicFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "sgs-selic-sample.json"), "utf-8"),
);
const ipcaFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "sgs-ipca-12m-sample.json"), "utf-8"),
);

// 2026-09-05/06 are a weekend, 2026-09-07 is Independência (a real ANBIMA
// holiday); the next session after 2026-09-04 skips all three.
const septemberSessions = [
  { date: "2026-09-01", open: "2026-09-01T13:00:00.000Z" },
  { date: "2026-09-02", open: "2026-09-02T13:00:00.000Z" },
  { date: "2026-09-03", open: "2026-09-03T13:00:00.000Z" },
  { date: "2026-09-04", open: "2026-09-04T13:00:00.000Z" },
  { date: "2026-09-08", open: "2026-09-08T13:00:00.000Z" },
  { date: "2026-09-09", open: "2026-09-09T13:00:00.000Z" },
  { date: "2026-09-15", open: "2026-09-15T13:00:00.000Z" },
  { date: "2026-09-16", open: "2026-09-16T13:00:00.000Z" },
];

// The IPCA fixture (series 13522) covers reference months January through
// July 2026; each point's asOf lands on or after the 15th of the following
// month (2026-02-15 through 2026-08-15). 2026-08-15/16 are a weekend, so the
// July point rolls to the Monday session; every other 15th here is a
// weekday. 2026-04-16 is kept as a second April session to exercise the
// same roll-forward behaviour without reaching into May.
const ipcaSessions = [
  { date: "2026-02-16", open: "2026-02-16T13:00:00.000Z" },
  { date: "2026-03-16", open: "2026-03-16T13:00:00.000Z" },
  { date: "2026-04-15", open: "2026-04-15T13:00:00.000Z" },
  { date: "2026-04-16", open: "2026-04-16T13:00:00.000Z" },
  { date: "2026-05-15", open: "2026-05-15T13:00:00.000Z" },
  { date: "2026-06-15", open: "2026-06-15T13:00:00.000Z" },
  { date: "2026-07-15", open: "2026-07-15T13:00:00.000Z" },
  { date: "2026-08-17", open: "2026-08-17T13:00:00.000Z" },
];

describe("parseSgsResponse", () => {
  it("cdi: asOf is the next session's open after the reference date", () => {
    const points = parseSgsResponse("cdi", cdiFixture, septemberSessions);
    expect(points[0]).toMatchObject({ date: "2026-09-01", asOf: "2026-09-02T13:00:00.000Z" });
    expect(points.at(-1)).toMatchObject({ date: "2026-09-08", asOf: "2026-09-09T13:00:00.000Z" });
  });

  it("cdi: skips the weekend and a holiday to find the next session", () => {
    const points = parseSgsResponse("cdi", cdiFixture, septemberSessions);
    const sept04 = points.find((point) => point.date === "2026-09-04");
    expect(sept04?.asOf).toBe("2026-09-08T13:00:00.000Z");
  });

  it("selic: asOf is the reference date's own session open", () => {
    const points = parseSgsResponse("selic", selicFixture, septemberSessions);
    expect(points[0]).toMatchObject({ date: "2026-09-01", asOf: "2026-09-01T13:00:00.000Z" });
    expect(points.at(-1)).toMatchObject({ date: "2026-09-08", asOf: "2026-09-08T13:00:00.000Z" });
  });

  it("selic: drops weekend/holiday duplicates the target rate repeats for every calendar day", () => {
    // sgs-selic-sample.json includes 2026-09-05/06 (weekend) and 2026-09-07
    // (Independência), none of which is a session in septemberSessions.
    const points = parseSgsResponse("selic", selicFixture, septemberSessions);
    expect(points).toHaveLength(5);
    expect(points.map((point) => point.date)).not.toContain("2026-09-05");
    expect(points.map((point) => point.date)).not.toContain("2026-09-07");
  });

  it("ipca: asOf is the open of the first session on or after the 15th of the following month", () => {
    const points = parseSgsResponse("ipca", ipcaFixture, ipcaSessions);
    const march = points.find((point) => point.date === "2026-03-01");
    expect(march).toMatchObject({ asOf: "2026-04-15T13:00:00.000Z" });
  });

  it("ipca: rolls forward when the 15th itself is not a session", () => {
    const sessionsWithoutApr15 = ipcaSessions.filter((s) => s.date !== "2026-04-15");
    const points = parseSgsResponse("ipca", ipcaFixture, sessionsWithoutApr15);
    const march = points.find((point) => point.date === "2026-03-01");
    expect(march?.asOf).toBe("2026-04-16T13:00:00.000Z");
  });

  it("throws when no session covers the required lookup (a calendar gap)", () => {
    expect(() => parseSgsResponse("cdi", cdiFixture, [])).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() =>
      parseSgsResponse("cdi", [{ data: "bad", valor: "x" }], septemberSessions),
    ).toThrow();
  });

  it("drops a point with an empty valor (a gap in the series) instead of failing the batch", () => {
    const withGap = [
      { data: "01/09/2026", valor: "" },
      { data: "02/09/2026", valor: "0.05" },
    ];
    const points = parseSgsResponse("cdi", withGap, septemberSessions);
    expect(points).toHaveLength(1);
    expect(points[0]?.date).toBe("2026-09-02");
  });
});

describe("resolveAsOfInstant", () => {
  it("cdi uses the next session strictly after the date", () => {
    expect(resolveAsOfInstant("cdi", "2026-09-01", septemberSessions)).toBe(
      "2026-09-02T13:00:00.000Z",
    );
  });

  it("selic uses the date's own session", () => {
    expect(resolveAsOfInstant("selic", "2026-09-01", septemberSessions)).toBe(
      "2026-09-01T13:00:00.000Z",
    );
  });
});

describe("convertToAnnualRate", () => {
  it("compounds a CDI daily rate (% a.d.) into an annual rate over 252 sessions", () => {
    // Reference: (1 + 0.05/100)^252 - 1 = 13.4246% a.a.
    const annual = convertToAnnualRate("cdi", "0.05");
    expect(Number(annual)).toBeCloseTo(13.4246, 3);
  });

  it("passes the Selic target rate through unchanged (already % a.a.)", () => {
    expect(convertToAnnualRate("selic", "14.00")).toBe("14.00000000");
  });

  it("passes the IPCA 12-month accumulated rate through unchanged (series 13522, already % a.a.)", () => {
    expect(convertToAnnualRate("ipca", "4.44")).toBe("4.44000000");
  });
});

describe("splitIntoTenYearWindows", () => {
  it("returns a single window for a span under 10 years", () => {
    const windows = splitIntoTenYearWindows("2020-01-01", "2026-09-08");
    expect(windows).toEqual([{ from: "2020-01-01", to: "2026-09-08" }]);
  });

  it("splits a span over 10 years into multiple windows of at most 10 years", () => {
    const windows = splitIntoTenYearWindows("2000-01-01", "2026-09-08");
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]).toEqual({ from: "2000-01-01", to: "2009-12-31" });
    expect(windows.at(-1)?.to).toBe("2026-09-08");
  });
});
