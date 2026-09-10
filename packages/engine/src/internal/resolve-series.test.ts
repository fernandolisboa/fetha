import { describe, expect, it } from "vitest";
import type { MarketView, OptionSeries } from "../api";
import { decimalString } from "../test/support";
import { collapseSeriesByTicker, resolveSeries } from "./resolve-series";

const at = "2024-01-10T21:00:00.000Z";

const baseView: MarketView = {
  calendar: [],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

function series(overrides: Partial<OptionSeries> = {}): OptionSeries {
  return {
    ticker: "PETR4C40",
    underlying: "PETR4",
    right: "call",
    strike: decimalString("40.00"),
    expiry: "2024-01-21",
    style: "european",
    asOf: at,
    ...overrides,
  };
}

describe("resolveSeries / collapseSeriesByTicker", () => {
  it("breaks an exact asOf tie for one ticker by the lower strike, regardless of array order (round 4 item 4)", () => {
    const higher = series({ strike: decimalString("42.00") });
    const lower = series({ strike: decimalString("38.00") });
    const forward: MarketView = { ...baseView, optionSeries: [higher, lower] };
    const reverse: MarketView = { ...baseView, optionSeries: [lower, higher] };
    expect(resolveSeries(forward, "PETR4C40", at)).toEqual(lower);
    expect(resolveSeries(reverse, "PETR4C40", at)).toEqual(lower);
  });

  it("collapseSeriesByTicker breaks the same tie the same way regardless of array order", () => {
    const higher = series({ strike: decimalString("42.00") });
    const lower = series({ strike: decimalString("38.00") });
    expect(collapseSeriesByTicker([higher, lower], at)).toEqual([lower]);
    expect(collapseSeriesByTicker([lower, higher], at)).toEqual([lower]);
  });

  it("extends the exact asOf tie-break to expiry when strikes match, regardless of array order (round 5 item 2)", () => {
    const earlierExpiry = series({ expiry: "2024-01-14" });
    const laterExpiry = series({ expiry: "2024-01-21" });
    const forward: MarketView = { ...baseView, optionSeries: [laterExpiry, earlierExpiry] };
    const reverse: MarketView = { ...baseView, optionSeries: [earlierExpiry, laterExpiry] };
    expect(resolveSeries(forward, "PETR4C40", at)).toEqual(earlierExpiry);
    expect(resolveSeries(reverse, "PETR4C40", at)).toEqual(earlierExpiry);
  });

  it("falls through to right when strike and expiry match, regardless of array order (round 5 item 2)", () => {
    const call = series({ right: "call" });
    const put = series({ right: "put" });
    const forward: MarketView = { ...baseView, optionSeries: [put, call] };
    const reverse: MarketView = { ...baseView, optionSeries: [call, put] };
    expect(resolveSeries(forward, "PETR4C40", at)).toEqual(call);
    expect(resolveSeries(reverse, "PETR4C40", at)).toEqual(call);
  });
});
