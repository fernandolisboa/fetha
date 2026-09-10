import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "./date-time";

describe("formatDate", () => {
  it("formats a date as dd/mm/yyyy in America/Sao_Paulo", () => {
    expect(formatDate(new Date("2026-10-17T14:32:00.000Z"))).toBe("17/10/2026");
  });

  it("shifts a UTC midnight boundary into the previous local day", () => {
    expect(formatDate(new Date("2026-10-17T02:00:00.000Z"))).toBe("16/10/2026");
  });
});

describe("formatTime", () => {
  it("formats a time as HH:mm in America/Sao_Paulo", () => {
    expect(formatTime(new Date("2026-10-17T14:32:00.000Z"))).toBe("11:32");
  });
});

describe("formatDateTime", () => {
  it("combines date and time separated by a space", () => {
    expect(formatDateTime(new Date("2026-10-17T14:32:00.000Z"))).toBe("17/10/2026 11:32");
  });
});
