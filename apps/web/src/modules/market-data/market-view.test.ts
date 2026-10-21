import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";

import { DAILY_TIMEFRAME, type CandleRow } from "./repositories/candle-repository";
import { sliceCalendarWindow, toEngineCandle } from "./market-view";

describe("toEngineCandle", () => {
  it("translates a row stored under the storage timeframe into the contracts vocabulary D1 (issue #71)", () => {
    expect(DAILY_TIMEFRAME).toBe("1d");

    const row: CandleRow = {
      ticker: tickerSchema.parse("PETR4"),
      session: sessionDateSchema.parse("2026-05-11"),
      asOf: new Date("2026-05-11T21:00:00.000Z"),
      open: decimalStringSchema.parse("10.000000"),
      high: decimalStringSchema.parse("11.000000"),
      low: decimalStringSchema.parse("9.000000"),
      close: decimalStringSchema.parse("10.750000"),
      tradedQuantity: 5000,
    };

    const candle = toEngineCandle(row);

    expect(candle.timeframe).toBe("D1");
  });
});

describe("sliceCalendarWindow", () => {
  const dates = ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"];
  const rows = dates.map((date) => ({
    date,
    open: new Date(`${date}T13:00:00.000Z`),
    close: new Date(`${date}T21:00:00.000Z`),
    asOf: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const calendar = {
    at: instantSchema.parse("2026-05-13T13:00:00.000Z"),
    session: sessionDateSchema.parse("2026-05-13"),
    rows,
  };

  it("keeps the latest past sessions by open, the session `at` opens included, and no future without an expiry", () => {
    expect(sliceCalendarWindow(calendar, 2, null).map((row) => row.date)).toEqual([
      "2026-05-12",
      "2026-05-13",
    ]);
  });

  it("extends forward through the expiry, inclusive, and no further", () => {
    expect(sliceCalendarWindow(calendar, 1, "2026-05-14").map((row) => row.date)).toEqual([
      "2026-05-13",
      "2026-05-14",
    ]);
  });

  it("refuses a past window wider than the one the calendar was loaded with", () => {
    expect(() => sliceCalendarWindow(calendar, 31, null)).toThrow();
  });
});
