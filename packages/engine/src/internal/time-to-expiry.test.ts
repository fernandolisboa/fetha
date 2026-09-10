import { describe, expect, it } from "vitest";
import type { TradingSession } from "../api";
import { resolveTimeToExpiryYears } from "./time-to-expiry";

const session = (date: string, open: string, close: string): TradingSession => ({
  date,
  open,
  close,
});

const calendar: TradingSession[] = [
  session("2024-01-08", "2024-01-08T13:00:00.000Z", "2024-01-08T21:00:00.000Z"),
  session("2024-01-09", "2024-01-09T13:00:00.000Z", "2024-01-09T21:00:00.000Z"),
  session("2024-01-10", "2024-01-10T13:00:00.000Z", "2024-01-10T21:00:00.000Z"),
  session("2024-01-11", "2024-01-11T13:00:00.000Z", "2024-01-11T21:00:00.000Z"),
  session("2024-01-12", "2024-01-12T13:00:00.000Z", "2024-01-12T21:00:00.000Z"),
];

describe("resolveTimeToExpiryYears (ADR-0013 (n + (1 - f)) / 252)", () => {
  it("counts a full trailing session as n/252 at that session's close (f=1)", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-08T21:00:00.000Z", "2024-01-12");
    expect(result).toEqual({ ok: true, years: 4 / 252 });
  });

  it("adds the unelapsed fraction of the current session at its open (f=0)", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-08T13:00:00.000Z", "2024-01-12");
    expect(result).toEqual({ ok: true, years: 5 / 252 });
  });

  it("is zero at the expiry session's own close", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-12T21:00:00.000Z", "2024-01-12");
    expect(result).toEqual({ ok: true, years: 0 });
  });

  it("is a positive fraction mid-session on the expiry date itself", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-12T17:00:00.000Z", "2024-01-12");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.years).toBeGreaterThan(0);
      expect(result.years).toBeLessThan(1 / 252);
    }
  });

  it("interpolates the fraction elapsed mid-session", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-08T17:00:00.000Z", "2024-01-12");
    expect(result).toEqual({ ok: true, years: (4 + 0.5) / 252 });
  });

  it("fails with calendar_gap when the calendar has no session open at or before `at`", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-01T13:00:00.000Z", "2024-01-12");
    expect(result).toEqual({ ok: false, reason: "calendar_gap" });
  });

  it("fails with calendar_gap when the expiry date is not in the calendar", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-08T13:00:00.000Z", "2024-02-01");
    expect(result).toEqual({ ok: false, reason: "calendar_gap" });
  });

  it("fails with already_expired when the expiry precedes the session containing `at`", () => {
    const result = resolveTimeToExpiryYears(calendar, "2024-01-12T13:00:00.000Z", "2024-01-08");
    expect(result).toEqual({ ok: false, reason: "already_expired" });
  });
});
