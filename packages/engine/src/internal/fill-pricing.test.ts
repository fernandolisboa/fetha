import { describe, expect, it } from "vitest";
import type { CostModel } from "@fetha/contracts";
import type { Leg, MarketView, TradingSession } from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import {
  fillCosts,
  grossCentavos,
  resolveFillOpportunity,
  slippageCentavos,
  slippedOptionPrice,
} from "./fill-pricing";

const costModel: CostModel = {
  b3FeeRate: decimalString("0.0003"),
  brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(50) },
  optionSlippageRate: decimalString("0.01"),
  incomeTaxRate: decimalString("0.15"),
  monthlyStockSalesExemption: centavos(20_000_00),
};

const session: TradingSession = {
  date: "2024-01-02",
  open: "2024-01-02T13:00:00.000Z",
  close: "2024-01-02T21:00:00.000Z",
};

const emptyView: MarketView = {
  calendar: [session],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

describe("grossCentavos", () => {
  it("multiplies price by quantity on the centavos scale", () => {
    expect(grossCentavos(decimalString("10.00"), 5).toNumber()).toBe(5_000);
  });
});

describe("fillCosts", () => {
  it("charges the stock brokerage for a stock fill", () => {
    // gross = 10.00 * 100 * 100(centavos) = 100_000; b3Fee = 100_000 * 0.0003 = 30
    expect(fillCosts(costModel, decimalString("10.00"), 100)).toBe(centavos(130));
  });

  it("charges the option brokerage for an option fill", () => {
    expect(fillCosts(costModel, decimalString("2.00"), 10, "option")).toBe(
      centavos(Math.round(2.0 * 10 * 100 * 0.0003) + 50),
    );
  });
});

describe("slippedOptionPrice", () => {
  it("adds slippage on a buy", () => {
    expect(slippedOptionPrice(decimalString("2.00"), "buy", decimalString("0.01"))).toBe(
      decimalString("2.02"),
    );
  });

  it("subtracts slippage on a sell", () => {
    expect(slippedOptionPrice(decimalString("2.00"), "sell", decimalString("0.01"))).toBe(
      decimalString("1.98"),
    );
  });
});

describe("slippageCentavos", () => {
  it("reports the absolute centavos difference between filled and reference price", () => {
    expect(slippageCentavos(decimalString("2.00"), decimalString("2.02"), 10)).toBe(centavos(20));
  });
});

describe("resolveFillOpportunity", () => {
  const stockLeg: Leg = { role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(100) };
  const callLeg: Leg = { role: "call", side: "buy", ticker: "PETR4C28", quantity: quantity(10) };

  it("is not ready for a stock leg with no candle at the session", () => {
    expect(resolveFillOpportunity(emptyView, costModel, stockLeg, session, "buy")).toEqual({
      ready: false,
    });
  });

  it("is not ready for a stock leg with an untraded candle", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: session.date,
          asOf: session.close,
          open: decimalString("10.00"),
          high: decimalString("10.00"),
          low: decimalString("10.00"),
          close: decimalString("10.00"),
          tradedQuantity: 0,
        },
      ],
    };
    expect(resolveFillOpportunity(view, costModel, stockLeg, session, "buy")).toEqual({
      ready: false,
    });
  });

  it("fills a stock leg at the session's own open, unslipped", () => {
    const view: MarketView = {
      ...emptyView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: session.date,
          asOf: session.close,
          open: decimalString("10.00"),
          high: decimalString("11.00"),
          low: decimalString("9.50"),
          close: decimalString("10.50"),
          tradedQuantity: 500,
        },
      ],
    };
    expect(resolveFillOpportunity(view, costModel, stockLeg, session, "buy")).toEqual({
      ready: true,
      price: decimalString("10.00"),
      reference: decimalString("10.00"),
      source: "next_session_open",
      kind: "stock",
    });
  });

  it("is not ready for an option leg with no day price at the session", () => {
    expect(resolveFillOpportunity(emptyView, costModel, callLeg, session, "buy")).toEqual({
      ready: false,
    });
  });

  it("is not ready for an option leg with no trades or no average", () => {
    const view: MarketView = {
      ...emptyView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: session.date,
          asOf: session.close,
          average: null,
          close: decimalString("2.10"),
          trades: 0,
          tradedQuantity: 0,
        },
      ],
    };
    expect(resolveFillOpportunity(view, costModel, callLeg, session, "buy")).toEqual({
      ready: false,
    });
  });

  it("fills an option leg at the session's average price plus buy-side slippage", () => {
    const view: MarketView = {
      ...emptyView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: session.date,
          asOf: session.close,
          average: decimalString("2.00"),
          close: null,
          trades: 3,
          tradedQuantity: 30,
        },
      ],
    };
    expect(resolveFillOpportunity(view, costModel, callLeg, session, "buy")).toEqual({
      ready: true,
      price: decimalString("2.02"),
      reference: decimalString("2.00"),
      source: "next_session_average",
      kind: "option",
    });
  });

  it("fills an option leg at the session's average price minus sell-side slippage", () => {
    const view: MarketView = {
      ...emptyView,
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: session.date,
          asOf: session.close,
          average: decimalString("2.00"),
          close: null,
          trades: 3,
          tradedQuantity: 30,
        },
      ],
    };
    expect(resolveFillOpportunity(view, costModel, callLeg, session, "sell")).toEqual({
      ready: true,
      price: decimalString("1.98"),
      reference: decimalString("2.00"),
      source: "next_session_average",
      kind: "option",
    });
  });
});
