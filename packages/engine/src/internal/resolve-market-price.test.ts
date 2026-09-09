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
});
