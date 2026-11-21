import { sessionDateSchema, tickerSchema, type SessionDate } from "@fetha/contracts";
import type { MarketView, OptionDayPrice } from "@fetha/engine";
import { describe, expect, it } from "vitest";

import { filterToTradedSeries } from "./traded-series";

const SESSION: SessionDate = sessionDateSchema.parse("2027-01-15");
const PRIOR_SESSION: SessionDate = sessionDateSchema.parse("2027-01-14");

function optionSeries(ticker: string) {
  return {
    ticker: tickerSchema.parse(ticker),
    underlying: tickerSchema.parse("PETR4"),
    right: "call" as const,
    strike: "36.000000" as never,
    expiry: SESSION,
    style: "european" as never,
    asOf: "2027-01-04T13:00:00.000Z" as never,
  };
}

function price(ticker: string, session: SessionDate, trades: number): OptionDayPrice {
  return {
    ticker: tickerSchema.parse(ticker),
    session,
    asOf: `${session}T20:00:00.000Z` as never,
    average: "1.500000" as never,
    close: "1.500000" as never,
    trades,
    tradedQuantity: trades * 100,
  };
}

function baseView(overrides: Partial<MarketView> = {}): MarketView {
  return {
    calendar: [],
    candles: [],
    corporateActions: [],
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
    ...overrides,
  };
}

describe("filterToTradedSeries", () => {
  it("keeps a series with at least one trade at the anchor session", () => {
    const traded = optionSeries("PETR4K36");
    const view = baseView({
      optionSeries: [traded],
      optionPrices: [price("PETR4K36", SESSION, 12)],
    });

    expect(filterToTradedSeries(view, SESSION).optionSeries).toEqual([traded]);
  });

  it("drops a series with a price row but zero trades at the anchor session", () => {
    const untraded = optionSeries("PETR4K38");
    const view = baseView({
      optionSeries: [untraded],
      optionPrices: [price("PETR4K38", SESSION, 0)],
    });

    expect(filterToTradedSeries(view, SESSION).optionSeries).toEqual([]);
  });

  it("drops a series with no price row at the anchor session at all", () => {
    const neverPriced = optionSeries("PETR4K40");
    const view = baseView({ optionSeries: [neverPriced], optionPrices: [] });

    expect(filterToTradedSeries(view, SESSION).optionSeries).toEqual([]);
  });

  it("ignores a trade recorded on a different session than the anchor", () => {
    const series = optionSeries("PETR4K36");
    const view = baseView({
      optionSeries: [series],
      optionPrices: [price("PETR4K36", PRIOR_SESSION, 12)],
    });

    expect(filterToTradedSeries(view, SESSION).optionSeries).toEqual([]);
  });

  it("keeps only the traded series among several, same as the real chain's mixed liquidity", () => {
    const traded = optionSeries("PETR4K36");
    const thinlyTraded = optionSeries("PETR4K37");
    const untraded = optionSeries("PETR4K38");
    const view = baseView({
      optionSeries: [traded, thinlyTraded, untraded],
      optionPrices: [
        price("PETR4K36", SESSION, 12),
        price("PETR4K37", SESSION, 1),
        price("PETR4K38", SESSION, 0),
      ],
    });

    expect(filterToTradedSeries(view, SESSION).optionSeries).toEqual([traded, thinlyTraded]);
  });
});
