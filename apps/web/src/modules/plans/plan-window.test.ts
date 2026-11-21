import { describe, expect, it } from "vitest";
import type { SessionDate } from "@fetha/contracts";
import type { TradingSession } from "@fetha/engine";

import { PLAN_MAX_SESSIONS_AHEAD, PLAN_MIN_SESSIONS_AHEAD } from "./plan-selection";
import { isWithinPlanWindow, sessionsAhead } from "./plan-window";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`fixture index ${String(index)} is out of bounds`);
  return value;
}

function sequentialDates(count: number): SessionDate[] {
  return Array.from({ length: count }, (_, index) => {
    const day = 1 + index;
    const month = 1 + Math.floor((day - 1) / 28);
    const dayOfMonth = ((day - 1) % 28) + 1;
    return `2027-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
  });
}

function calendarOf(dates: readonly SessionDate[]): TradingSession[] {
  return dates.map((date) => ({
    date,
    open: `${date}T13:00:00.000Z`,
    close: `${date}T20:00:00.000Z`,
  }));
}

describe("sessionsAhead", () => {
  const dates = sequentialDates(10);
  const calendar = calendarOf(dates);

  it("counts the sessions strictly between the anchor and the expiry", () => {
    expect(sessionsAhead(calendar, at(dates, 0), at(dates, 5))).toBe(5);
  });

  it("returns null when the expiry is not after the anchor", () => {
    expect(sessionsAhead(calendar, at(dates, 3), at(dates, 1))).toBeNull();
    expect(sessionsAhead(calendar, at(dates, 2), at(dates, 2))).toBeNull();
  });

  it("returns null when either date is not a listed session", () => {
    expect(sessionsAhead(calendar, at(dates, 0), "2099-01-01")).toBeNull();
    expect(sessionsAhead(calendar, "2099-01-01", at(dates, 1))).toBeNull();
  });
});

describe("isWithinPlanWindow", () => {
  const dates = sequentialDates(60);
  const calendar = calendarOf(dates);

  it("accepts an expiry inside the plan's 20-50 session window", () => {
    expect(isWithinPlanWindow(calendar, at(dates, 0), at(dates, PLAN_MIN_SESSIONS_AHEAD))).toBe(
      true,
    );
    expect(isWithinPlanWindow(calendar, at(dates, 0), at(dates, PLAN_MAX_SESSIONS_AHEAD))).toBe(
      true,
    );
  });

  it("refuses an expiry nearer than the plan's minimum window", () => {
    expect(
      isWithinPlanWindow(calendar, at(dates, 0), at(dates, PLAN_MIN_SESSIONS_AHEAD - 1)),
    ).toBe(false);
  });

  it("refuses an expiry past the plan's maximum window", () => {
    expect(
      isWithinPlanWindow(calendar, at(dates, 0), at(dates, PLAN_MAX_SESSIONS_AHEAD + 1)),
    ).toBe(false);
  });
});
