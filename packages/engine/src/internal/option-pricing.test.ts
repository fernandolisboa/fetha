import { describe, expect, it } from "vitest";
import { decimalString, quantity } from "../test/support";
import { bsmPriceRaw } from "./black-scholes";
import { priceOptionLeg } from "./option-pricing";

// Hull, Options, Futures, and Other Derivatives: S0=42, K=40, r=10%, sigma=20%, T=0.5,
// c ~= 4.76 (ch. 15), delta N(d1) ~= 0.7791 (ch. 19).
const hullCallLeg = {
  role: "call" as const,
  side: "buy" as const,
  ticker: "PETR4C40" as const,
  quantity: quantity(1),
};

describe("priceOptionLeg (Hull S0=42, K=40, r=10%, sigma=20%, T=0.5)", () => {
  it("prices fair value near Hull's $4.76 from a given volatility (what-if)", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(Number(valuation.fairValue)).toBeCloseTo(4.76, 1);
    expect(valuation.volatilitySource).toBe("given");
    expect(valuation.notes).toContainEqual({
      code: "european_pricing",
      message: "priced as a European option under Black-Scholes-Merton (ADR-0002)",
    });
  });

  it("computes delta near Hull's N(d1) = 0.7791", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(Number(valuation.greeks?.delta)).toBeCloseTo(0.7791, 3);
  });

  it("reports theta per session (annual theta / 252), negative for a long call", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(Number(valuation.greeks?.theta)).toBeCloseTo(-4.5504 / 252, 4);
  });

  it("solves implied volatility from a visible market price and reprices it (own_implied)", () => {
    const marketPrice = bsmPriceRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: {
        value: decimalString(marketPrice.toFixed(2)),
        source: "close",
        stale: null,
      },
      givenVolatility: null,
    });
    expect(Number(valuation.impliedVolatility)).toBeCloseTo(0.2, 2);
    expect(valuation.volatilitySource).toBe("own_implied");
    expect(Number(valuation.fairValue)).toBeCloseTo(marketPrice, 1);
  });

  it("marks a stale leg's solved volatility as last_trade_implied", () => {
    const marketPrice = bsmPriceRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: {
        value: decimalString(marketPrice.toFixed(2)),
        source: "close",
        stale: { session: "2024-01-08" },
      },
      givenVolatility: null,
    });
    expect(valuation.volatilitySource).toBe("last_trade_implied");
  });

  it("notes iv_from_average_price when the resolved market price came from the session average", () => {
    const marketPrice = bsmPriceRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: { value: decimalString(marketPrice.toFixed(2)), source: "average", stale: null },
      givenVolatility: null,
    });
    expect(valuation.notes).toContainEqual({
      code: "iv_from_average_price",
      message: "implied volatility solved from the session average price",
    });
  });

  it("notes no_market_price and leaves fairValue null when there is neither a market price nor a given volatility", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: null,
    });
    expect(valuation.price).toBeNull();
    expect(valuation.fairValue).toBeNull();
    expect(valuation.greeks).toBeNull();
    expect(valuation.notes).toContainEqual({
      code: "no_market_price",
      message: "no market price visible for this leg",
    });
  });

  it("keeps the given volatility for fair value while still reporting implied volatility from a market price", () => {
    const marketPrice = bsmPriceRaw({
      s: 42,
      k: 40,
      t: 0.5,
      r: 0.1,
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: { value: decimalString(marketPrice.toFixed(2)), source: "close", stale: null },
      givenVolatility: decimalString("0.35"),
    });
    expect(valuation.volatilitySource).toBe("given");
    expect(Number(valuation.impliedVolatility)).toBeCloseTo(0.2, 2);
    expect(Number(valuation.fairValue)).not.toBeCloseTo(marketPrice, 1);
  });

  it("notes iv_not_converged without below_intrinsic for a price above the model's reachable range", () => {
    const upperPrice = bsmPriceRaw({ s: 42, k: 40, t: 0.5, r: 0.1, q: 0, sigma: 5, right: "call" });
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: {
        value: decimalString((upperPrice + 1).toFixed(2)),
        source: "close",
        stale: null,
      },
      givenVolatility: null,
    });
    expect(valuation.notes).toContainEqual({
      code: "iv_not_converged",
      message: "implied volatility did not converge from the visible market price",
    });
    expect(valuation.notes).not.toContainEqual({
      code: "below_intrinsic",
      message: "market price is below the model's intrinsic value floor",
    });
  });

  it("notes iv_not_converged and below_intrinsic for an arbitrage-violating market price", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: { value: decimalString("1.00"), source: "close", stale: null },
      givenVolatility: null,
    });
    expect(valuation.notes).toContainEqual({
      code: "iv_not_converged",
      message: "implied volatility did not converge from the visible market price",
    });
    expect(valuation.notes).toContainEqual({
      code: "below_intrinsic",
      message: "market price is below the model's intrinsic value floor",
    });
    expect(valuation.fairValue).toBeNull();
  });

  it("floors a negative time to expiry at zero (expiry already passed the session close)", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("45.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: -0.01,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(valuation.timeToExpiryYears).toBe(decimalString("0.000000"));
    expect(Number(valuation.fairValue)).toBeCloseTo(5, 2);
  });

  it("prices a put leg and reports a negative delta", () => {
    const valuation = priceOptionLeg({
      leg: { role: "put", side: "buy", ticker: "PETR4P40" as const, quantity: quantity(1) },
      strike: decimalString("40.00"),
      spot: decimalString("42.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(Number(valuation.fairValue)).toBeCloseTo(0.81, 1);
    expect(Number(valuation.greeks?.delta)).toBeLessThan(0);
  });

  it("never throws and reports a null fairValue/greeks for a non-positive spot (last-line seam guard)", () => {
    const valuation = priceOptionLeg({
      leg: hullCallLeg,
      strike: decimalString("40.00"),
      spot: decimalString("0.00"),
      riskFreeRate: decimalString("0.10"),
      dividendYield: decimalString("0.00"),
      timeToExpiryYears: 0.5,
      marketPrice: null,
      givenVolatility: decimalString("0.20"),
    });
    expect(valuation.fairValue).toBeNull();
    expect(valuation.greeks).toBeNull();
  });
});
