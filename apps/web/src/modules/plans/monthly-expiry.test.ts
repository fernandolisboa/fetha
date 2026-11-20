import { sessionDateSchema, tickerSchema, type SessionDate } from "@fetha/contracts";
import type { MarketView, TradingSession } from "@fetha/engine";
import { describe, expect, it } from "vitest";

import { filterToMonthlyExpiries, isB3MonthlyExpiry } from "./monthly-expiry";

function session(date: string): TradingSession {
  return {
    date: sessionDateSchema.parse(date),
    open: `${date}T13:00:00.000Z` as never,
    close: `${date}T20:00:00.000Z` as never,
  };
}

const JANUARY_WEEKDAYS = [
  "2027-01-04",
  "2027-01-05",
  "2027-01-06",
  "2027-01-07",
  "2027-01-08",
  "2027-01-11",
  "2027-01-12",
  "2027-01-13",
  "2027-01-14",
  "2027-01-15",
  "2027-01-18",
  "2027-01-19",
  "2027-01-20",
  "2027-01-21",
  "2027-01-22",
];

describe("isB3MonthlyExpiry", () => {
  it("names the third Friday of the month when it is a trading session", () => {
    const calendar = JANUARY_WEEKDAYS.map(session);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2027-01-15"), calendar)).toBe(true);
  });

  it("rejects a weekly expiry in the same month, even another Friday", () => {
    const calendar = JANUARY_WEEKDAYS.map(session);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2027-01-08"), calendar)).toBe(false);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2027-01-22"), calendar)).toBe(false);
  });

  it("moves to the previous trading session when the third Friday is a holiday", () => {
    const calendar = JANUARY_WEEKDAYS.filter((date) => date !== "2027-01-15").map(session);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2027-01-14"), calendar)).toBe(true);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2027-01-15"), calendar)).toBe(false);
  });
});

function optionSeries(expiry: SessionDate, right: "call" | "put" = "call") {
  return {
    ticker: tickerSchema.parse("PETR4"),
    underlying: tickerSchema.parse("PETR4"),
    right,
    strike: "36.000000" as never,
    expiry,
    style: "european" as never,
    asOf: "2027-01-04T13:00:00.000Z" as never,
  };
}

describe("filterToMonthlyExpiries", () => {
  it("keeps only series at the month's monthly expiry, dropping a weekly in the window", () => {
    const calendar = JANUARY_WEEKDAYS.map(session);
    const monthly = optionSeries(sessionDateSchema.parse("2027-01-15"));
    const weekly = optionSeries(sessionDateSchema.parse("2027-01-08"));
    const view: MarketView = {
      calendar,
      candles: [],
      corporateActions: [],
      optionSeries: [monthly, weekly],
      optionPrices: [],
      quotes: [],
      macro: [],
      dividendYields: [],
      impliedVolatilityIndex: [],
    };

    const filtered = filterToMonthlyExpiries(view);

    expect(filtered.optionSeries).toEqual([monthly]);
  });
});
