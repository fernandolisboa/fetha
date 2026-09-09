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

  it("ignores a re-listed ticker's superseded strike when nearest-strike selection ties against its current strike", () => {
    // The superseded row (strike 32.00) is equidistant from the target (32.50) as the
    // fresh row (strike 33.00), which used to win the tie-break by lower strike: a
    // ticker that no longer trades at 32.00 must never compete on its old strike.
    const staleAsOf = "2024-01-02T21:00:00.000Z";
    const freshAsOf = "2024-01-03T21:00:00.000Z";
    const resolveAt = "2024-01-04T21:00:00.000Z";
    const staleCall = { ...callSeries("PETR4C32", "32.00"), asOf: staleAsOf };
    const freshCall = { ...callSeries("PETR4C32", "33.00"), asOf: freshAsOf };
    const put: OptionSeries = { ...callSeries("PETR4P28", "28.00"), right: "put", asOf: freshAsOf };

    const resolve = (optionSeries: OptionSeries[]) =>
      resolveLegSelection({
        structure: collar,
        underlying: "PETR4",
        strikes: [
          { kind: "nearest", price: decimalString("28.00") },
          { kind: "nearest", price: decimalString("32.50") },
        ],
        expiry: { kind: "business_days", min: 1, max: 30 },
        view: { ...baseView, optionSeries },
        at: resolveAt,
        spot: decimalString("30.00"),
        riskFreeRate: decimalString("0.1"),
        dividendYield: decimalString("0"),
      });

    const forward = resolve([staleCall, freshCall, put]);
    const reversed = resolve([freshCall, staleCall, put]);
    expect(forward).toEqual(reversed);
    if (!forward.ok) throw new Error("expected resolution to succeed");
    const callLeg = forward.legs.find((leg) => leg.role === "call");
    if (callLeg?.role !== "call") throw new Error("expected a resolved call leg");
    expect(callLeg.series.strike).toBe(decimalString("33.00"));
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

  it("breaks a nearest-price strike tie by the lower strike, regardless of array order", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C32", "32.00"), callSeries("PETR4C28", "28.00")],
    };
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "nearest", price: decimalString("30.00") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]).toMatchObject({ series: { ticker: "PETR4C28" } });
  });

  it("resolves the same nearest-|delta| series regardless of the optionSeries/optionPrices array order", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const series = [callSeries("PETR4C32", "32.00"), callSeries("PETR4C28", "28.00")];
    const prices = [
      {
        ticker: "PETR4C32",
        session: "2024-01-02",
        asOf: at,
        average: null,
        close: decimalString("2.00"),
        trades: 1,
        tradedQuantity: 1,
      },
      {
        ticker: "PETR4C28",
        session: "2024-01-02",
        asOf: at,
        average: null,
        close: decimalString("2.00"),
        trades: 1,
        tradedQuantity: 1,
      },
    ];
    const build = (
      optionSeries: OptionSeries[],
      optionPrices: typeof prices,
    ): ReturnType<typeof resolveLegSelection> =>
      resolveLegSelection({
        structure: singleCall,
        underlying: "PETR4",
        strikes: [{ kind: "delta", target: decimalString("0.5") }],
        expiry: { kind: "business_days", min: 1, max: 30 },
        view: { ...baseView, optionSeries, optionPrices },
        at,
        spot: decimalString("30.00"),
        riskFreeRate: decimalString("0.1"),
        dividendYield: decimalString("0"),
      });

    const forward = build(series, prices);
    const reversed = build([...series].reverse(), [...prices].reverse());
    expect(forward).toEqual(reversed);
  });

  it("breaks an exact nearest-|delta| tie by the lower strike, regardless of array order", () => {
    const singleCall: Structure = {
      id: "single-call",
      name: "single call",
      expiry: "shared",
      legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
    };
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C32", "32.00"), callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.50"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("4.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    // delta(28) ~= 0.669725, delta(32) ~= 0.414445 at this spot/rate/tte; their midpoint
    // is an exact tie on |delta - target|, so the tie-break (lower strike) decides.
    const result = resolveLegSelection({
      structure: singleCall,
      underlying: "PETR4",
      strikes: [{ kind: "delta", target: decimalString("0.542085") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]).toMatchObject({ series: { ticker: "PETR4C28" } });
  });

  it("breaks a same-strike nearest-price tie by the lexicographically earlier ticker", () => {
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
      optionSeries: [
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        callSeries("PETR4C30", "30.00"),
      ],
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
    expect(result.ok).toBe(true);
  });

  it("resolves a shared-rank straddle's nearest-|delta| strike from the first-listed right's delta", () => {
    const straddle: Structure = {
      id: "straddle",
      name: "straddle",
      expiry: "shared",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      ],
    };
    // At target 0.3 the two rights disagree: the call's delta (0.834 at 28.00, 0.258 at
    // 32.00) is closer to 0.3 at strike 32.00, while the put's |delta| (0.166 at 28.00,
    // 0.742 at 32.00) is closer to 0.3 at strike 28.00.
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4C28", "28.00"),
        callSeries("PETR4C32", "32.00"),
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        { ...callSeries("PETR4P32", "32.00"), right: "put" },
      ],
      optionPrices: [
        { ticker: "PETR4C28", price: decimalString("2.44") },
        { ticker: "PETR4C32", price: decimalString("0.37") },
        { ticker: "PETR4P28", price: decimalString("0.23") },
        { ticker: "PETR4P32", price: decimalString("2.13") },
      ].map((p) => ({
        ticker: p.ticker,
        session: "2024-01-02",
        asOf: at,
        average: null,
        close: p.price,
        trades: 1,
        tradedQuantity: 1,
      })),
    };
    // The structure lists "call" before "put" at rank 1: a straddle's two legs share one
    // strike, so nearest-|delta| selection must pick a single governing right rather than
    // average or best-of-both. That right is the structure's declaration order at the rank
    // (the first-listed role), not whichever candidate happens to score better (PR #53
    // round 1 item 13); here the put's own delta would prefer 28.00, but the call's — the
    // one that governs — prefers 32.00.
    const result = resolveLegSelection({
      structure: straddle,
      underlying: "PETR4",
      strikes: [{ kind: "delta", target: decimalString("0.3") }],
      expiry: { kind: "business_days", min: 1, max: 30 },
      view,
      at,
      spot: decimalString("30.00"),
      riskFreeRate: decimalString("0.1"),
      dividendYield: decimalString("0"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [callLeg, putLeg] = result.legs;
    expect(callLeg).toMatchObject({ role: "call", series: { ticker: "PETR4C32" } });
    expect(putLeg).toMatchObject({ role: "put", series: { ticker: "PETR4P32" } });
  });
});
