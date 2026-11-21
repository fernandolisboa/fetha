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

  // Pinned to real B3 instrument data: `apps/web/e2e/fixtures/b3-instruments/
  // 2026-09-18.csv` lists PETR4 monthly series expiring 2026-11-19 and 2028-04-20 — the third
  // Friday of each month (2026-11-20, 2028-04-21) is a B3 holiday (Consciência Negra, Tiradentes),
  // so the real expiry falls on the trading session immediately before it, confirming the
  // backward walk above, not a forward one.
  it("walks backward off a holiday third Friday, matching real PETR4 monthly expiries", () => {
    const novemberWeekdays = [
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      // 2026-11-20 (the third Friday) is Consciência Negra: not a trading session.
      "2026-11-23",
    ];
    const novemberCalendar = novemberWeekdays.map(session);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2026-11-19"), novemberCalendar)).toBe(true);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2026-11-20"), novemberCalendar)).toBe(false);

    const aprilWeekdays = [
      "2028-04-17",
      "2028-04-18",
      "2028-04-19",
      "2028-04-20",
      // 2028-04-21 (the third Friday) is Tiradentes: not a trading session.
      "2028-04-24",
    ];
    const aprilCalendar = aprilWeekdays.map(session);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2028-04-20"), aprilCalendar)).toBe(true);
    expect(isB3MonthlyExpiry(sessionDateSchema.parse("2028-04-21"), aprilCalendar)).toBe(false);
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
