import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CalendarFetchError, anbimaCalendarUrl, fetchTradingSessions } from "./fetch";

const fixture = readFileSync(
  path.join(import.meta.dirname, "fixtures", "holidays-sample.csv"),
  "utf-8",
);

function fakeFetch(status: number, body: string): typeof fetch {
  return () => Promise.resolve(new Response(body, { status }));
}

describe("anbimaCalendarUrl", () => {
  it("builds a per-year holiday file URL", () => {
    expect(anbimaCalendarUrl(2026)).toBe(
      "https://www.anbima.com.br/feriados/arqs/feriados_nacionais.csv?ano=2026",
    );
  });
});

describe("fetchTradingSessions", () => {
  it("builds the year's trading sessions from the holiday file", async () => {
    const sessions = await fetchTradingSessions(2026, fakeFetch(200, fixture));
    expect(sessions.length).toBeGreaterThan(200);
    expect(sessions.some((session) => session.date === "2026-01-01")).toBe(false);
  });

  it("throws CalendarFetchError on a non-ok response", async () => {
    await expect(fetchTradingSessions(2026, fakeFetch(404, ""))).rejects.toThrow(
      CalendarFetchError,
    );
  });
});
