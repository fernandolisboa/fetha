import { describe, expect, it } from "vitest";

import { closeFreshnessKind, sessionDateToDisplayDate } from "./close-freshness";

describe("closeFreshnessKind", () => {
  it("labels the session that matches today in America/Sao_Paulo", () => {
    expect(closeFreshnessKind("2026-10-17", new Date("2026-10-17T21:05:00.000Z"))).toEqual({
      kind: "today",
    });
  });

  it("labels the session that matches yesterday in America/Sao_Paulo", () => {
    expect(closeFreshnessKind("2026-10-16", new Date("2026-10-17T12:00:00.000Z"))).toEqual({
      kind: "yesterday",
    });
  });

  it("labels an older session with the session itself", () => {
    expect(closeFreshnessKind("2026-10-10", new Date("2026-10-17T12:00:00.000Z"))).toEqual({
      kind: "older",
      session: "2026-10-10",
    });
  });

  it("uses the São Paulo calendar day, not the UTC day, near the day boundary", () => {
    // 2026-10-17T02:00:00Z is still 2026-10-16 23:00 in America/Sao_Paulo.
    expect(closeFreshnessKind("2026-10-16", new Date("2026-10-17T02:00:00.000Z"))).toEqual({
      kind: "today",
    });
  });

  it("recomputes against a later `now`: yesterday's close ages into an older session", () => {
    const session = "2026-10-16";
    expect(closeFreshnessKind(session, new Date("2026-10-17T12:00:00.000Z"))).toEqual({
      kind: "yesterday",
    });
    expect(closeFreshnessKind(session, new Date("2026-10-19T12:00:00.000Z"))).toEqual({
      kind: "older",
      session,
    });
  });
});

describe("sessionDateToDisplayDate", () => {
  it("resolves to noon UTC on the session's calendar date", () => {
    const date = sessionDateToDisplayDate("2026-10-10");
    expect(date.toISOString()).toBe("2026-10-10T12:00:00.000Z");
  });
});
