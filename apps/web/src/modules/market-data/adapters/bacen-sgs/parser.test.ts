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
    const points = parseSgsResponse("selic", cdiFixture, septemberSessions);
    expect(points[0]).toMatchObject({ date: "2026-09-01", asOf: "2026-09-01T13:00:00.000Z" });
  });

  it("ipca: asOf is the open of the first session on or after the 15th of the following month", () => {
    const points = parseSgsResponse("ipca", ipcaFixture, septemberSessions);
    expect(points[0]).toMatchObject({ date: "2026-08-31", asOf: "2026-09-15T13:00:00.000Z" });
  });

  it("ipca: rolls forward when the 15th itself is not a session", () => {
    const sessionsWithout15th = septemberSessions.filter((s) => s.date !== "2026-09-15");
    const points = parseSgsResponse("ipca", ipcaFixture, sessionsWithout15th);
    expect(points[0]?.asOf).toBe("2026-09-16T13:00:00.000Z");
  });

  it("throws when no session covers the required lookup (a calendar gap)", () => {
    expect(() => parseSgsResponse("cdi", cdiFixture, [])).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() =>
      parseSgsResponse("cdi", [{ data: "bad", valor: "x" }], septemberSessions),
    ).toThrow();
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
    expect(convertToAnnualRate("selic", "10.75")).toBe("10.75000000");
  });

  it("passes the IPCA 12-month accumulated rate through unchanged (series 13522, already % a.a.)", () => {
    expect(convertToAnnualRate("ipca", "4.35")).toBe("4.35000000");
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
