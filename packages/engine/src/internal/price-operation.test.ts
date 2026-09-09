import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Structure } from "@fetha/contracts";
import type { MarketView, OptionSeries, TradingSession } from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import { priceOperation } from "./price-operation";

function dailyCalendar(fromDay: number, count: number): TradingSession[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(fromDay + i).padStart(2, "0");
    return {
      date: `2024-01-${day}`,
      open: `2024-01-${day}T13:00:00.000Z`,
      close: `2024-01-${day}T21:00:00.000Z`,
    };
  });
}

const calendar = dailyCalendar(2, 20);
const at = "2024-01-02T21:00:00.000Z";
const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const baseView: MarketView = {
  calendar,
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null }],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

function callSeries(ticker: string, strike: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right: "call",
    strike: decimalString(strike),
    expiry: "2024-01-21",
    style: "european",
    asOf: at,
  };
}

describe("priceOperation (concrete legs)", () => {
  it("prices a single long stock leg, deriving spot from the underlying's own quote", () => {
    const result = priceOperation(
      {
        view: baseView,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.netPremium).toBe(centavos(-30_00 * 100));
    expect(result.value.spot).toBe(decimalString("30.00"));
  });

  it("returns missing_instrument for an option leg with no listed series (never a whole-call throw)", () => {
    const result = priceOperation(
      {
        view: { ...baseView, optionSeries: [] },
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C40",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4C40" });
  });

  it("marks a leg with no visible price and no given volatility as null fairValue via a note, never a whole-call error", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
    const result = priceOperation(
      {
        view,
        at,
        legs: [{ role: "call", side: "buy", ticker: "PETR4C40", quantity: quantity(1) }],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.fairValue).toBeNull();
    expect(result.value.legs[0]?.notes).toContainEqual({
      code: "no_market_price",
      message: "no market price visible for this leg",
    });
    expect(result.value.notes).toContainEqual({
      code: "no_market_price",
      message: "at least one leg has no visible market price",
    });
  });

  it("prices a Hull-consistent long call leg from a given volatility and reports positive delta", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("42.00"), bid: null, ask: null }],
      optionSeries: [callSeries("PETR4C40", "40.00")],
      macro: [
        { series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("0.105709") },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C40",
            quantity: quantity(1),
            volatility: decimalString("0.20"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.greeks?.delta).toBeDefined();
    expect(Number(result.value.legs[0]?.greeks?.delta)).toBeGreaterThan(0.5);
  });

  it("reports no_risk_profile and empty limitBreaches when no risk profile is supplied", () => {
    const result = priceOperation(
      {
        view: baseView,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.limitBreaches).toEqual([]);
    expect(result.value.notes).toContainEqual({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
  });

  it("breaches maxExposurePerOperation, maxPremiumBought and maxOpenOperations together", () => {
    const result = priceOperation(
      {
        view: baseView,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
        ],
        openOperationCount: 5,
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("0.1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("0.1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.limitBreaches.map((b) => b.limit).sort()).toEqual(
      ["maxExposurePerOperation", "maxOpenOperations", "maxPremiumBought"].sort(),
    );
  });

  it("breaches maxLossPerOperation against declared capital", () => {
    const result = priceOperation(
      {
        view: baseView,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
        ],
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("0.1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.limitBreaches).toContainEqual(
      expect.objectContaining({ limit: "maxLossPerOperation" }),
    );
  });

  it("skips the maxLossPerOperation ratio check for an unbounded maxLoss but still checks exposure", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C28", "28.00")] };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C28",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxLoss).toBe("unbounded");
    expect(result.value.limitBreaches.some((b) => b.limit === "maxLossPerOperation")).toBe(false);
  });

  it("computes a bull call spread's bounded maxLoss/maxGain from a given-volatility priced structure", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C28",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C32",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxLoss).not.toBe("unbounded");
    expect(result.value.maxGain).not.toBe("unbounded");
    if (result.value.maxLoss === "unbounded" || result.value.maxGain === "unbounded") return;
    // A vertical call spread's max gain plus max loss equals the strike width in centavos
    // (per unit): the structure is worth exactly (K2 - K1) at expiry above K2, zero below K1.
    expect(result.value.maxGain + result.value.maxLoss).toBe(centavos((32 - 28) * 100));
  });

  it("reports a breakeven exactly at the upper strike when the debit paid equals the strike width", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C28",
            quantity: quantity(1),
            price: decimalString("5.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C32",
            quantity: quantity(1),
            price: decimalString("1.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toContainEqual(decimalString("32.00"));
  });

  it("derives the underlying's spot from a bid/ask mid quote when no last is visible", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        {
          ticker: "PETR4",
          asOf: at,
          last: null,
          bid: decimalString("29.50"),
          ask: decimalString("30.50"),
        },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBe(decimalString("30.00"));
  });

  it("falls back to the latest visible D1 candle close for the underlying's spot", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [],
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-02",
          asOf: at,
          open: decimalString("29.00"),
          high: decimalString("31.00"),
          low: decimalString("28.50"),
          close: decimalString("30.50"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBe(decimalString("30.50"));
  });

  it("picks the later of two visible D1 candles when resolving the underlying's spot from candles", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [],
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-01",
          asOf: "2024-01-01T21:00:00.000Z",
          open: decimalString("28.00"),
          high: decimalString("29.00"),
          low: decimalString("27.50"),
          close: decimalString("28.50"),
          tradedQuantity: 500,
        },
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-02",
          asOf: at,
          open: decimalString("29.00"),
          high: decimalString("31.00"),
          low: decimalString("28.50"),
          close: decimalString("30.50"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.spot).toBe(decimalString("30.50"));
  });

  it("resolves an option leg's price from a bid/ask mid quote when no price is given", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
      quotes: [
        ...baseView.quotes,
        {
          ticker: "PETR4C28",
          asOf: at,
          last: null,
          bid: decimalString("2.40"),
          ask: decimalString("2.60"),
        },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [{ role: "call", side: "buy", ticker: "PETR4C28", quantity: quantity(1) }],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.price).toBe(decimalString("2.50"));
    expect(result.value.legs[0]?.priceSource).toBe("mid");
  });

  it("returns invalid_input when an option leg's underlying does not match the operation's underlying", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("VALE3C40", "40.00"), underlying: "VALE3" }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
          {
            role: "call",
            side: "buy",
            ticker: "VALE3C40",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns missing_instrument when a concrete stock leg's underlying has no visible spot", () => {
    const result = priceOperation(
      {
        view: { ...baseView, quotes: [], candles: [] },
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4" });
  });

  it("returns invalid_input when no legs are supplied", () => {
    const result = priceOperation({ view: baseView, at, legs: [] }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input when the underlying's spot resolves to zero (concrete legs)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("0.00"), bid: null, ask: null }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input when a concrete option leg's listed strike is not positive", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4C00", "0.00") }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C00",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("reports a short stock leg's per-leg delta unsigned and only signs the aggregate", () => {
    const result = priceOperation(
      {
        view: baseView,
        at,
        legs: [
          {
            role: "stock",
            side: "sell",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.greeks?.delta).toBe(decimalString("1.000000"));
    expect(result.value.greeks.delta).toBe(decimalString("-100.000000"));
  });

  it("returns invalid_input when the visible cdi annual rate is at or below -1 (concrete legs)", () => {
    const view: MarketView = {
      ...baseView,
      macro: [{ series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("-1.00") }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "macro.cdi.annualRate",
      message: "annual rate must be greater than -1",
    });
  });

  it("returns invalid_input when the visible dividend yield is at or below -1 (concrete legs)", () => {
    const view: MarketView = {
      ...baseView,
      dividendYields: [{ underlying: "PETR4", asOf: at, annualYield: decimalString("-1.00") }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "dividendYields.annualYield",
      message: "annual rate must be greater than -1",
    });
  });

  it("aggregates a mixed long-stock/short-call structure's delta to the signed sum of its legs", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C32", "32.00")] };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C32",
            quantity: quantity(1),
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stockDelta = 100;
    const callLegDelta = Number(result.value.legs[1]?.greeks?.delta);
    expect(Number(result.value.greeks.delta)).toBeCloseTo(stockDelta - callLegDelta, 6);
  });
});

describe("priceOperation properties (vertical spreads, given prices)", () => {
  it("a long call vertical spread's maxGain + maxLoss equals the strike width (per unit, centavos)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }),
        fc.integer({ min: 1, max: 30 }),
        (lowerStrike, width) => {
          const upperStrike = lowerStrike + width;
          const view: MarketView = {
            ...baseView,
            optionSeries: [
              callSeries("PETR4CL", String(lowerStrike)),
              callSeries("PETR4CU", String(upperStrike)),
            ],
          };
          const result = priceOperation(
            {
              view,
              at,
              legs: [
                {
                  role: "call",
                  side: "buy",
                  ticker: "PETR4CL",
                  quantity: quantity(1),
                  volatility: decimalString("0.25"),
                },
                {
                  role: "call",
                  side: "sell",
                  ticker: "PETR4CU",
                  quantity: quantity(1),
                  volatility: decimalString("0.25"),
                },
              ],
            },
            provenanceBase,
          );
          if (!result.ok) return false;
          if (result.value.maxLoss === "unbounded" || result.value.maxGain === "unbounded")
            return false;
          return result.value.maxGain + result.value.maxLoss === width * 100;
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("priceOperation (selection: strike ranks, degenerate strikes, expiry window)", () => {
  const structure: Structure = {
    id: "bull-call-spread",
    name: "Bull call spread",
    expiry: "shared",
    legs: [
      { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
      { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
    ],
  };

  it("resolves nearest-price strike selections and prices the resulting concrete legs", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.50") },
            { kind: "nearest", price: decimalString("31.50") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs.map((l) => l.leg.ticker)).toEqual(["PETR4C28", "PETR4C32"]);
  });

  it("resolves moneyness-relative strike selections", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "moneyness", percent: decimalString("-0.06") },
            { kind: "moneyness", percent: decimalString("0.07") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs.map((l) => l.leg.ticker)).toEqual(["PETR4C28", "PETR4C32"]);
  });

  it("reports degenerate_strikes when two distinct ranks resolve to the same listed strike", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C30", "30.00")] };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("30.00") },
            { kind: "nearest", price: decimalString("30.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("degenerate_strikes");
  });

  it("reports no_series_matches when no listed expiry falls inside the business-day window", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.00") },
            { kind: "nearest", price: decimalString("32.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 2 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_series_matches");
  });

  it("returns invalid_input when the visible cdi annual rate is at or below -1 (selection)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
      macro: [{ series: "cdi", date: "2024-01-01", asOf: at, annualRate: decimalString("-1.00") }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.50") },
            { kind: "nearest", price: decimalString("31.50") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("resolves the delta selection to the listed strike with the nearest |delta| to the target", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.50"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("0.60"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const oneLegStructure: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "delta", target: decimalString("0.75") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.leg.ticker).toBe("PETR4C28");
  });
});

describe("priceOperation (selection: collar with a stock leg)", () => {
  it("resolves a collar's stock leg untouched alongside its put/call strike selections", () => {
    const collar: Structure = {
      id: "collar",
      name: "Collar",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 100 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
      ],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C32", "32.00"),
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: collar,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.00") },
            { kind: "nearest", price: decimalString("32.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs.map((l) => l.leg.role)).toEqual(["stock", "put", "call"]);
    expect(result.value.legs[0]?.leg.ticker).toBe("PETR4");
    expect(result.value.legs[0]?.leg.quantity).toBe(100);
  });
});

describe("priceOperation (selection: quantity resolution)", () => {
  const oneLegStructure: Structure = {
    id: "single-call",
    name: "single call",
    expiry: "shared",
    legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
  };
  const view: MarketView = {
    ...baseView,
    optionSeries: [callSeries("PETR4C28", "28.00")],
    optionPrices: [
      {
        ticker: "PETR4C28",
        session: "2024-01-02",
        asOf: at,
        average: null,
        close: decimalString("3.00"),
        trades: 1,
        tradedQuantity: 1,
      },
    ],
  };

  it("returns insufficient_data when sizing a structure with an unpriced leg", () => {
    const unpricedView: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
    };
    const result = priceOperation(
      {
        view: unpricedView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("returns unsizeable(no_declared_capital) for a SizingRule quantity without a risk profile", () => {
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.1") },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "no_declared_capital" });
  });

  it("sizes a fixed_fractional quantity against declared capital and the structure's per-unit premium", () => {
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.leg.quantity).toBeGreaterThan(0);
  });

  it("sizes a fixed_risk quantity against declared capital and the structure's per-unit max loss", () => {
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_risk", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.leg.quantity).toBeGreaterThan(0);
  });

  it("returns unsizeable(zero_units) when the structure's per-unit premium is zero (fixed_fractional)", () => {
    const zeroPremiumView: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("0.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = priceOperation(
      {
        view: zeroPremiumView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "zero_units" });
  });

  it("returns unsizeable(zero_units) when the structure's per-unit max loss is zero (fixed_risk)", () => {
    const zeroPremiumView: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("0.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = priceOperation(
      {
        view: zeroPremiumView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_risk", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "zero_units" });
  });

  it("returns unsizeable(zero_units) when the budget cannot afford one unit (R$100 budget, R$500 per unit)", () => {
    const expensiveView: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("500.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = priceOperation(
      {
        view: expensiveView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.01") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "zero_units" });
  });

  it("returns missing_instrument when a LegSelection's underlying has no visible spot", () => {
    const noSpotView: MarketView = {
      ...baseView,
      quotes: [],
      optionSeries: [callSeries("PETR4C28", "28.00")],
    };
    const result = priceOperation(
      {
        view: noSpotView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4" });
  });

  it("returns invalid_input when a LegSelection's underlying spot resolves to zero", () => {
    const zeroSpotView: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("0.00"), bid: null, ask: null }],
      optionSeries: [callSeries("PETR4C28", "28.00")],
    };
    const result = priceOperation(
      {
        view: zeroSpotView,
        at,
        legs: {
          structure: oneLegStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: quantity(1),
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns unsizeable(unbounded_max_loss) for a fixed_risk quantity on a naked short call", () => {
    const shortCallStructure: Structure = {
      id: "naked-short-call",
      name: "naked short call",
      expiry: "shared",
      legs: [{ role: "call", side: "sell", ratio: 1, strikeRank: 1 }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: shortCallStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_risk", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "unbounded_max_loss" });
  });

  it("sizes a fixed_fractional net-credit structure against maxLoss, not the premium received", () => {
    const view2: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const structure: Structure = {
      id: "bear-call-spread",
      name: "Bear call spread",
      expiry: "shared",
      legs: [
        { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
        { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: view2,
        at,
        legs: {
          structure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.00") },
            { kind: "nearest", price: decimalString("32.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.netPremium).toBeGreaterThan(0);
    if (result.value.maxLoss === "unbounded") throw new Error("maxLoss must be bounded here");
    const units = result.value.legs[0]?.leg.quantity ?? 0;
    const budget = 10_000_00 * 0.5;
    const perUnitMaxLoss = result.value.maxLoss / units;
    // Sizing by the strike width (max loss), not by the premium received, would clamp
    // sizing to far fewer units than premium-based sizing on a thin net-credit spread.
    expect(units).toBe(Math.floor(budget / perUnitMaxLoss));
  });

  it("returns unsizeable(unbounded_max_loss) for a fixed_fractional net-credit naked short call", () => {
    const shortCallStructure: Structure = {
      id: "naked-short-call-fractional",
      name: "naked short call",
      expiry: "shared",
      legs: [{ role: "call", side: "sell", ratio: 1, strikeRank: 1 }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: {
          structure: shortCallStructure,
          underlying: "PETR4",
          strikes: [{ kind: "nearest", price: decimalString("28.00") }],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        },
        riskProfile: {
          declaredCapital: centavos(10_000_00),
          limits: {
            maxLossPerOperation: decimalString("1"),
            maxExposurePerOperation: decimalString("1"),
            maxOpenOperations: 5,
            maxPremiumBought: decimalString("1"),
          },
        },
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "unbounded_max_loss" });
  });
});
