import { describe, expect, it } from "vitest";
import { tickerSchema, type DecimalString, type SessionDate } from "@fetha/contracts";
import type { MarketView, OptionSeries } from "@fetha/engine";

import { chainFromMonthlyView, expiryOptionsFrom } from "./chain-view";

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

describe("expiryOptionsFrom", () => {
  it("lists only traded, upcoming expiries, nearest first", () => {
    const chain = [
      {
        ticker: tickerSchema.parse("PETRC001"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: "2027-02-19",
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC002"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: "2027-01-15",
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC003"),
        right: "call" as const,
        strike: decimal("36"),
        expiry: "2026-12-18",
        traded: true,
      },
      {
        ticker: tickerSchema.parse("PETRC004"),
        right: "call" as const,
        strike: decimal("40"),
        expiry: "2027-03-19",
        traded: false,
      },
    ];
    expect(expiryOptionsFrom(chain, "2027-01-02")).toEqual(["2027-01-15", "2027-02-19"]);
  });

  it("caps the chip list at six expiries", () => {
    const chain = Array.from({ length: 10 }, (_, index) => ({
      ticker: tickerSchema.parse(`PETRC0${String(index)}`),
      right: "call" as const,
      strike: decimal("36"),
      expiry: `2027-0${String((index % 9) + 1)}-15`,
      traded: true,
    }));
    expect(expiryOptionsFrom(chain, "2027-01-01")).toHaveLength(6);
  });
});
