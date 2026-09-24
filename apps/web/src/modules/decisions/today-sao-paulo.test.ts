import { describe, expect, it } from "vitest";

import { todaySaoPauloDate } from "./today-sao-paulo";

describe("todaySaoPauloDate", () => {
  it("reads the calendar date in São Paulo, not UTC", () => {
    // 2026-01-01T02:00:00Z is 2025-12-31 23:00 in São Paulo (fixed UTC-3).
    expect(todaySaoPauloDate(new Date("2026-01-01T02:00:00.000Z"))).toBe("2025-12-31");
  });

  it("matches UTC once São Paulo has crossed into the same calendar day", () => {
    expect(todaySaoPauloDate(new Date("2026-01-01T12:00:00.000Z"))).toBe("2026-01-01");
  });

  it("crosses the day boundary at 03:00 UTC", () => {
    expect(todaySaoPauloDate(new Date("2026-06-15T02:59:59.000Z"))).toBe("2026-06-14");
    expect(todaySaoPauloDate(new Date("2026-06-15T03:00:00.000Z"))).toBe("2026-06-15");
  });
});
