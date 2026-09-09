import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { convertToAnnualRate, parseSgsResponse, splitIntoTenYearWindows } from "./parser";

const cdiFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "sgs-cdi-sample.json"), "utf-8"),
);

describe("parseSgsResponse", () => {
  it("parses DD/MM/YYYY dates into ISO sessions with the session open as asOf", () => {
    const points = parseSgsResponse("cdi", cdiFixture);
    expect(points[0]).toMatchObject({
      series: "cdi",
      date: "2026-09-07",
      asOf: "2026-09-07T13:00:00.000Z",
    });
  });

  it("rejects a malformed payload", () => {
    expect(() => parseSgsResponse("cdi", [{ data: "bad", valor: "x" }])).toThrow();
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

  it("compounds an IPCA monthly rate (% a.m.) into an annual rate over 12 months", () => {
    const annual = convertToAnnualRate("ipca", "0.30");
    expect(Number(annual)).toBeCloseTo(3.6577, 2);
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
