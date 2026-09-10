import { describe, expect, it } from "vitest";
import type { MarketView } from "../api";
import { decimalString } from "../test/support";
import { resolveLegMarketPrice } from "./resolve-market-price";

const at = "2024-01-02T21:00:00.000Z";

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

describe("resolveLegMarketPrice", () => {
  it("falls back to the session average when no close is visible", () => {
    const view: MarketView = {
      ...baseView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: decimalString("2.75"),
          close: null,
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = resolveLegMarketPrice(view, "PETR4C28", at);
    expect(result).toEqual({ value: decimalString("2.75"), source: "average", stale: null });
  });

  it("returns null when no price is visible anywhere", () => {
    expect(resolveLegMarketPrice(baseView, "PETR4C28", at)).toBeNull();
  });

  it("flags stale when the price row's session differs from the session of at (ADR-0014 Q42)", () => {
    const view: MarketView = {
      ...baseView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-01",
          asOf: at,
          average: null,
          close: decimalString("2.50"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = resolveLegMarketPrice(view, "PETR4C28", at, undefined, "2024-01-02");
    expect(result).toEqual({
      value: decimalString("2.50"),
      source: "close",
      stale: { session: "2024-01-01" },
    });
  });

  it("does not flag stale when the price row's session matches the session of at", () => {
    const view: MarketView = {
      ...baseView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("2.50"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = resolveLegMarketPrice(view, "PETR4C28", at, undefined, "2024-01-02");
    expect(result).toEqual({ value: decimalString("2.50"), source: "close", stale: null });
  });

  it("reads a stock's D1 candle close when no quote or optionPrices row exists (item 1)", () => {
    const view: MarketView = {
      ...baseView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-02",
          asOf: at,
          open: decimalString("11.00"),
          high: decimalString("12.50"),
          low: decimalString("10.50"),
          close: decimalString("12.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = resolveLegMarketPrice(view, "PETR4", at, undefined, "2024-01-02", "stock");
    expect(result).toEqual({ value: decimalString("12.00"), source: "close", stale: null });
  });

  it("flags a stock's D1 candle mark stale when its session precedes the mark session", () => {
    const view: MarketView = {
      ...baseView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-01",
          asOf: at,
          open: decimalString("11.00"),
          high: decimalString("12.50"),
          low: decimalString("10.50"),
          close: decimalString("12.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = resolveLegMarketPrice(view, "PETR4", at, undefined, "2024-01-02", "stock");
    expect(result).toEqual({
      value: decimalString("12.00"),
      source: "close",
      stale: { session: "2024-01-01" },
    });
  });

  it("never reads optionPrices for a stock leg", () => {
    const view: MarketView = {
      ...baseView,
      optionPrices: [
        {
          ticker: "PETR4",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("99.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    expect(resolveLegMarketPrice(view, "PETR4", at, undefined, "2024-01-02", "stock")).toBeNull();
  });
});
