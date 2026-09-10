import { describe, expect, it } from "vitest";
import type { TradingSession } from "@fetha/engine";

import { resolveWarmupSession } from "./market-view";

function session(date: string, open: string, close: string): TradingSession {
  return { date, open, close };
}

const calendar: TradingSession[] = [
  session("2024-01-02", "2024-01-02T13:00:00.000Z", "2024-01-02T20:00:00.000Z"),
  session("2024-01-03", "2024-01-03T13:00:00.000Z", "2024-01-03T20:00:00.000Z"),
  session("2024-01-04", "2024-01-04T13:00:00.000Z", "2024-01-04T20:00:00.000Z"),
  session("2024-01-05", "2024-01-05T13:00:00.000Z", "2024-01-05T20:00:00.000Z"),
];

describe("resolveWarmupSession", () => {
  it("resolves to the calendar's first session when the window starts at its open", () => {
    const result = resolveWarmupSession(calendar, "2024-01-02T13:00:00.000Z");
    expect(result?.date).toBe("2024-01-02");
  });

  // dataWindow() returns the *close* of the session preceding the earliest
  // needed one, not that session's own open: the regression this guards
  // matched only the second form and silently fell back to `fromSession`,
  // loading zero warm-up history for every indicator strategy.
  it("resolves to the session after the one whose close the window starts at", () => {
    const result = resolveWarmupSession(calendar, "2024-01-03T20:00:00.000Z");
    expect(result?.date).toBe("2024-01-04");
  });

  it("returns undefined when the window's from matches no session boundary", () => {
    expect(resolveWarmupSession(calendar, "2099-01-01T00:00:00.000Z")).toBeUndefined();
  });
});
