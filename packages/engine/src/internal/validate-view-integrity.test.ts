import { describe, expect, it } from "vitest";
import type { MarketView } from "../api";
import { decimalString } from "../test/support";
import { validateViewIntegrity } from "./validate-view-integrity";

const baseView: MarketView = {
  calendar: [
    { date: "2024-01-02", open: "2024-01-02T13:00:00.000Z", close: "2024-01-02T21:00:00.000Z" },
  ],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

describe("validateViewIntegrity", () => {
  it("accepts a calendar and candles with no duplicates", () => {
    expect(validateViewIntegrity(baseView)).toBeNull();
  });

  it("rejects a calendar with a duplicate date (item 11)", () => {
    const view: MarketView = {
      ...baseView,
      calendar: [
        ...baseView.calendar,
        { date: "2024-01-02", open: "2024-01-02T13:00:00.000Z", close: "2024-01-02T22:00:00.000Z" },
      ],
    };
    expect(validateViewIntegrity(view)).toEqual({
      code: "invalid_input",
      path: "view.calendar",
      message: "duplicate calendar date 2024-01-02",
    });
  });

  it("rejects candles with a duplicate (ticker, timeframe, asOf) (item 11)", () => {
    const candle = {
      ticker: "PETR4",
      timeframe: "D1" as const,
      session: "2024-01-02",
      asOf: "2024-01-02T21:00:00.000Z",
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 100,
    };
    const view: MarketView = {
      ...baseView,
      candles: [candle, { ...candle, close: decimalString("11.00") }],
    };
    expect(validateViewIntegrity(view)).toEqual({
      code: "invalid_input",
      path: "view.candles",
      message: "duplicate candle for PETR4|D1|2024-01-02T21:00:00.000Z",
    });
  });

  it("allows two candles for the same ticker/timeframe with different asOf", () => {
    const candle = {
      ticker: "PETR4",
      timeframe: "D1" as const,
      session: "2024-01-02",
      asOf: "2024-01-02T21:00:00.000Z",
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 100,
    };
    const later = { ...candle, asOf: "2024-01-02T21:05:00.000Z" };
    expect(validateViewIntegrity({ ...baseView, candles: [candle, later] })).toBeNull();
  });
});
