import { describe, expect, it } from "vitest";
import type { Structure } from "@fetha/contracts";
import type { MarketView, OptionSeries, TradingSession } from "../api";
import { decimalString } from "../test/support";
import { resolveLegSelection } from "./resolve-leg-selection";

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

const baseView: MarketView = {
  calendar,
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
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

describe("resolveLegSelection", () => {
  it("keeps a stock leg untouched (no strike/expiry to resolve) and resolves its option legs", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C32", "32.00"),
      ],
    };
    const result = resolveLegSelection({
      structure: collar,
      underlying: "PETR4",
      strikes: [
        { kind: "nearest", price: decimalString("28.00") },
        { kind: "nearest", price: decimalString("32.00") },
      ],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]).toEqual({ templateIndex: 0, role: "stock" });
  });

  it("returns invalid_input when strikes.length does not match the number of distinct ranks", () => {
    const result = resolveLegSelection({
      structure: collar,
      underlying: "PETR4",
      strikes: [{ kind: "nearest", price: decimalString("28.00") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view: baseView,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns insufficient_data when the calendar has no session at or before `at`", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "nearest", price: decimalString("28.00") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view: { ...baseView, calendar: [] },
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("skips a delta candidate with no visible market price and one whose price is below intrinsic value", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4C20", "20.00"),
        callSeries("PETR4C28", "28.00"),
        callSeries("PETR4C40", "40.00"),
      ],
      optionPrices: [
        // PETR4C20: no price at all (skipped for missing market price)
        // PETR4C28: below intrinsic (30 - 28 = 2), so IV fails to converge (skipped)
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C40",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("0.50"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "delta", target: decimalString("0.5") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]).toMatchObject({ role: "call", series: { ticker: "PETR4C40" } });
  });

  it("ignores a listed expiry date that the calendar does not cover", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2099-01-01" }],
    };
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "nearest", price: decimalString("28.00") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_series_matches");
  });

  it("returns no_series_matches when a rank's right has no listed candidate at the chosen expiry", () => {
    const putCallSpread: Structure = {
      id: "put-call-mix",
      name: "put/call mix",
      expiry: "shared",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C28", "28.00")] };
    const result = resolveLegSelection({
      structure: putCallSpread,
      underlying: "PETR4",
      strikes: [
        { kind: "nearest", price: decimalString("28.00") },
        { kind: "nearest", price: decimalString("26.00") },
      ],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_series_matches");
  });

  it("returns no_series_matches when a straddle rank resolves to a strike listed for only one right", () => {
    const straddle: Structure = {
      id: "straddle",
      name: "straddle",
      expiry: "shared",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      ],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4P30", "30.00"), right: "put" }],
    };
    const result = resolveLegSelection({
      structure: straddle,
      underlying: "PETR4",
      strikes: [{ kind: "nearest", price: decimalString("30.00") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_series_matches");
  });

  it("returns no_series_matches when a delta selection finds no priceable candidate", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C20", "20.00")] };
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "delta", target: decimalString("0.5") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_series_matches");
  });
});
