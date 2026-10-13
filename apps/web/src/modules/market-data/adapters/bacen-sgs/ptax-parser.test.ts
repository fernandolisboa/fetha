import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parsePtaxResponse, ptaxAsOf } from "./ptax-parser";

const usdFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "ptax-usdbrl-sample.json"), "utf-8"),
);

describe("ptaxAsOf", () => {
  it("fixes the PTAX publication instant at 13:30 America/Sao_Paulo (16:30Z)", () => {
    expect(ptaxAsOf("2026-10-09")).toBe("2026-10-09T16:30:00.000Z");
  });
});

describe("parsePtaxResponse", () => {
  it("parses every point of a recorded window into rate, date and a fixed asOf", () => {
    const points = parsePtaxResponse("USDBRL", usdFixture);

    expect(points).toHaveLength(21);
    expect(points[0]).toEqual({
      pair: "USDBRL",
      date: "2026-01-02",
      asOf: "2026-01-02T16:30:00.000Z",
      rate: "5.43720000",
    });
  });

  it("drops a point with an empty valor instead of failing the whole batch", () => {
    const points = parsePtaxResponse("USDBRL", [
      { data: "02/01/2026", valor: "5.4372" },
      { data: "03/01/2026", valor: "" },
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]?.date).toBe("2026-01-02");
  });

  it("rejects a non-numeric valor without quoting it in the error", () => {
    expect(() =>
      parsePtaxResponse("USDBRL", [{ data: "02/01/2026", valor: "not-a-number" }]),
    ).toThrow("PTAX returned a non-numeric value for USDBRL on 02/01/2026");
  });

  // 09/07/2026 is a Thursday; Bacen published a PTAX for it (recorded live,
  // 2026-10-13), even though it is not necessarily a B3 trading session —
  // Bacen's own business-day calendar for PTAX differs from B3's
  // (ADR-0061). Unlike parseSgsResponse's selic branch, this parser takes no
  // `sessions` argument at all, so a date absent from any trading calendar
  // is never dropped or made to throw a calendar-coverage error.
  it("keeps a published date even when it is not a B3 trading session", () => {
    const points = parsePtaxResponse("USDBRL", [
      { data: "08/07/2026", valor: "5.1552" },
      { data: "09/07/2026", valor: "5.1329" },
      { data: "10/07/2026", valor: "5.1088" },
    ]);

    expect(points.map((point) => point.date)).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });

  it("parses the euro pair under its own SGS code the same way", () => {
    const points = parsePtaxResponse("EURBRL", [{ data: "08/10/2026", valor: "5.6093000" }]);

    expect(points).toEqual([
      { pair: "EURBRL", date: "2026-10-08", asOf: "2026-10-08T16:30:00.000Z", rate: "5.60930000" },
    ]);
  });
});
