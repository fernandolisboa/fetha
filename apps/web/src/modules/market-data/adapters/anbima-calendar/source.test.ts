import { describe, expect, it } from "vitest";

import { tradingSessionsForYear } from "./source";

describe("tradingSessionsForYear", () => {
  it("builds a full year of sessions from the committed ANBIMA holiday list", () => {
    const sessions = tradingSessionsForYear(2026);
    expect(sessions.length).toBeGreaterThan(200);
    expect(sessions.some((session) => session.date === "2026-01-01")).toBe(false);
    expect(sessions.some((session) => session.date === "2026-12-25")).toBe(false);
  });

  it("covers years from 2024 through next year", () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      expect(tradingSessionsForYear(year).length).toBeGreaterThan(200);
    }
  });
});
