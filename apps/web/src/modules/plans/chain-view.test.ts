import { describe, expect, it } from "vitest";
import { tickerSchema, type DecimalString, type SessionDate } from "@fetha/contracts";
import type { MarketView, OptionSeries, TradingSession } from "@fetha/engine";

import { chainFromMonthlyView, expiryOptionsFrom } from "./chain-view";
import { PLAN_MAX_SESSIONS_AHEAD, PLAN_MIN_SESSIONS_AHEAD } from "./plan-selection";

// A calendar long enough to carry the plan's own 20-50-session window past any of this test's
// own expiries (`expiryOptionsFrom` refuses a chip outside it): one session per calendar day
// starting at the anchor itself, so `session + N` days is always exactly `N` sessions ahead of
// it.
function windowedCalendar(anchor: string, days: number): TradingSession[] {
  const start = new Date(`${anchor}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const iso = date.toISOString().slice(0, 10);
    return {
      date: iso,
      open: `${iso}T13:00:00.000Z`,
      close: `${iso}T20:00:00.000Z`,
    };
  });
}

const UNDERLYING = tickerSchema.parse("PETR4");

function decimal(value: string): DecimalString {
  return value as DecimalString;
}

function series(
  ticker: string,
  strike: string,
  expiry: SessionDate,
  asOf = "2027-01-02T20:00:00.000Z",
): OptionSeries {
  return {
    ticker: tickerSchema.parse(ticker),
    underlying: UNDERLYING,
    right: "call",
    strike: decimal(strike),
    expiry,
    style: "american",
    asOf,
  };
}

function viewWith(optionSeries: OptionSeries[], tradedTickers: string[]): MarketView {
  return {
    calendar: [],
    candles: [],
    corporateActions: [],
    optionSeries,
    optionPrices: tradedTickers.map((ticker) => ({
      ticker: tickerSchema.parse(ticker),
      session: "2027-01-02",
      asOf: "2027-01-02T20:00:00.000Z",
      average: decimal("1.000000"),
      close: decimal("1.000000"),
      trades: 5,
      tradedQuantity: 100,
    })),
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}

describe("chainFromMonthlyView", () => {
  it("marks a series with a recorded trade at the session as traded", () => {
    const view = viewWith([series("PETRC36", "36.000000", "2027-01-15")], ["PETRC36"]);
    const chain = chainFromMonthlyView(view, "2027-01-02", "2027-01-02T20:00:00.000Z");
    expect(chain).toEqual([
      {
        ticker: "PETRC36",
        right: "call",
        strike: "36.000000",
        expiry: "2027-01-15",
        traded: true,
      },
    ]);
  });

  it("dims a listed series with no trade recorded that session", () => {
    const view = viewWith([series("PETRC40", "40.000000", "2027-01-15")], []);
    const chain = chainFromMonthlyView(view, "2027-01-02", "2027-01-02T20:00:00.000Z");
    expect(chain[0]?.traded).toBe(false);
  });

  it("keeps only the latest registry record as of the pricing instant", () => {
    const stale = series("PETRC36", "36.000000", "2027-01-15", "2026-06-01T20:00:00.000Z");
    const fresh = series("PETRC36", "36.500000", "2027-01-15", "2027-01-01T20:00:00.000Z");
    const view = viewWith([stale, fresh], ["PETRC36"]);
    const chain = chainFromMonthlyView(view, "2027-01-02", "2027-01-02T20:00:00.000Z");
    expect(chain).toHaveLength(1);
    expect(chain[0]?.strike).toBe("36.500000");
  });

  it("never reads a registry record stamped after the pricing instant", () => {
    const future = series("PETRC36", "99.000000", "2027-01-15", "2027-06-01T20:00:00.000Z");
    const view = viewWith([future], []);
    const chain = chainFromMonthlyView(view, "2027-01-02", "2027-01-02T20:00:00.000Z");
    expect(chain).toEqual([]);
  });
});

function dateAt(calendar: readonly TradingSession[], index: number): SessionDate {
  const session = calendar[index];
  if (!session) throw new Error(`fixture index ${String(index)} is out of bounds`);
  return session.date;
}

describe("expiryOptionsFrom", () => {
  const CALENDAR = windowedCalendar("2027-01-02", 70);
  const ANCHOR = dateAt(CALENDAR, 0);
  const withinWindowA = dateAt(CALENDAR, PLAN_MIN_SESSIONS_AHEAD);
  const withinWindowB = dateAt(CALENDAR, PLAN_MIN_SESSIONS_AHEAD + 15);
  const tooNear = dateAt(CALENDAR, PLAN_MIN_SESSIONS_AHEAD - 1);
  const tooFar = dateAt(CALENDAR, PLAN_MAX_SESSIONS_AHEAD + 1);

  it("lists only traded expiries inside the plan's own window, nearest first", () => {
    const chain = [
      {
        ticker: tickerSchema.parse("PETRC001"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: withinWindowB,
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC002"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: withinWindowA,
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC003"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: tooNear,
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC004"),
        right: "call" as const,
        strike: decimal("40"),
        expiry: tooFar,
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC005"),
        right: "call" as const,
        strike: decimal("40"),
        expiry: withinWindowB,
        traded: false,
      },
    ];
    expect(expiryOptionsFrom(chain, ANCHOR, CALENDAR)).toEqual([withinWindowA, withinWindowB]);
  });

  it("caps the chip list at six expiries", () => {
    const chain = Array.from({ length: 10 }, (_, index) => ({
      ticker: tickerSchema.parse(`PETRC0${String(index)}`),
      right: "call" as const,
      strike: decimal("36"),
      expiry: dateAt(CALENDAR, PLAN_MIN_SESSIONS_AHEAD + index),
      traded: true,
    }));
    expect(expiryOptionsFrom(chain, ANCHOR, CALENDAR)).toHaveLength(6);
  });
});
