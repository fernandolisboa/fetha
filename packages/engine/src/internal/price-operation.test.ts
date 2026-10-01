import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Structure } from "@fetha/contracts";
import type { MarketView, OptionSeries } from "../api";
import { centavos, dailyCalendar, decimalString, quantity } from "../test/support";
import { PRICE_SCALE, toDecimalString } from "./decimal";
import { priceOperation } from "./price-operation";

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

  it("rejects a calendar that lists a session twice as invalid_input (#40)", () => {
    const [first] = baseView.calendar;
    if (!first) throw new Error("fixture calendar is empty");
    const result = priceOperation(
      {
        view: { ...baseView, calendar: [...baseView.calendar, { ...first }] },
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
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        path: "view.calendar",
        message: `duplicate calendar date ${first.date}`,
      },
    });
  });

  it("rejects a non-positive given volatility as invalid_input", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
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
            volatility: decimalString("0.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
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

  it("reports no break-evens for an identically-zero payoff (buying and selling the same call at the same volatility)", () => {
    const view: MarketView = {
      ...baseView,
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
          {
            role: "call",
            side: "sell",
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
    expect(result.value.breakEvens).toEqual([]);
    expect(result.value.maxLoss).toBe(centavos(0));
    expect(result.value.maxGain).toBe(centavos(0));
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

  it("interpolates a vertical spread's breakeven strictly between the two strikes for a partial debit", () => {
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
            price: decimalString("3.00"),
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
    // Net debit 2.00, so the breakeven is at 28 + 2.00 = 30.00, strictly between the strikes.
    expect(result.value.breakEvens).toContainEqual(decimalString("30.00"));
  });

  it("extrapolates a long call's breakeven beyond its own strike (unbounded upside tail)", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
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
            price: decimalString("2.50"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxGain).toBe("unbounded");
    expect(result.value.breakEvens).toContainEqual(decimalString("42.50"));
  });

  it("computes a collar's bounded maxLoss/maxGain and both put/call breakevens", () => {
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
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P28",
            quantity: quantity(1),
            price: decimalString("1.00"),
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
    expect(result.value.maxLoss).not.toBe("unbounded");
    expect(result.value.maxGain).not.toBe("unbounded");
    if (result.value.maxLoss === "unbounded" || result.value.maxGain === "unbounded") return;
    // Zero-cost collar (put and call premiums cancel): downside capped at the put strike,
    // upside capped at the call strike, both measured from the 30.00 entry price.
    expect(result.value.maxLoss).toBe(centavos((30 - 28) * 100));
    expect(result.value.maxGain).toBe(centavos((32 - 30) * 100));
  });

  it("emits a payoff point at every leg strike, equal to maxLoss/maxGain, sorted ascending and de-duplicated", () => {
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
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker: "PETR4",
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P28",
            quantity: quantity(100),
            price: decimalString("0.70"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C32",
            quantity: quantity(100),
            price: decimalString("0.60"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxLoss).toBe(centavos(210_00));
    expect(result.value.maxGain).toBe(centavos(190_00));

    const atPutStrike = result.value.payoff.find((p) => p.underlying === decimalString("28.00"));
    const atCallStrike = result.value.payoff.find((p) => p.underlying === decimalString("32.00"));
    expect(atPutStrike?.pnl).toBe(centavos(-210_00));
    expect(atCallStrike?.pnl).toBe(centavos(190_00));

    const underlyings = result.value.payoff.map((p) => Number(p.underlying));
    expect(underlyings).toEqual([...underlyings].sort((a, b) => a - b));
    expect(new Set(result.value.payoff.map((p) => p.underlying)).size).toBe(
      result.value.payoff.length,
    );
    expect(result.value.payoff.map((p) => p.underlying)).toEqual(
      expect.arrayContaining([decimalString("28.00"), decimalString("32.00")]),
    );
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

  it("prefers the bid/ask mid over last for the underlying's spot, matching a leg's own price precedence", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        {
          ticker: "PETR4",
          asOf: at,
          last: decimalString("31.00"),
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

  it("marks an option leg's mark stale when the price row's session is earlier than the session of at", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
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
    expect(result.value.legs[0]?.stale).toEqual({ session: "2024-01-01" });
    expect(result.value.legs[0]?.notes).toContainEqual({
      code: "stale_price",
      message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
    });
  });

  it("suppresses the implied-volatility solve for a stale option mark whose session precedes a visible ex-date on the underlying", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
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
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.5"),
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
    const leg = result.value.legs[0];
    expect(leg?.stale).toEqual({ session: "2024-01-01" });
    expect(leg?.impliedVolatility).toBeNull();
    expect(leg?.volatilitySource).toBeNull();
    expect(leg?.fairValue).toBeNull();
    expect(leg?.greeks).toBeNull();
    expect(leg?.notes).toContainEqual({
      code: "stale_price_across_corporate_action",
      message:
        "the last traded price predates a corporate-action ex-date on the underlying; implied volatility is not solved from it",
    });
  });

  it("does not flag the operation-level iv_not_converged note for a leg whose solve was only suppressed across a corporate action", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
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
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.5"),
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
    expect(result.value.notes).not.toContainEqual(
      expect.objectContaining({ code: "iv_not_converged" }),
    );
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "stale_price_across_corporate_action" }),
    );
  });

  it("does not suppress the implied-volatility solve for a corporate action not yet visible at `at`", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00")],
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
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T21:00:00.001Z",
          factor: decimalString("0.5"),
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
    const leg = result.value.legs[0];
    expect(leg?.stale).toEqual({ session: "2024-01-01" });
    expect(leg?.impliedVolatility).not.toBeNull();
    expect(leg?.greeks).not.toBeNull();
    expect(leg?.notes).not.toContainEqual(
      expect.objectContaining({ code: "stale_price_across_corporate_action" }),
    );
  });

  it("marks a stock leg's mark stale when the price row's session is earlier than the session of at", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [],
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-01",
          asOf: at,
          open: decimalString("29.00"),
          high: decimalString("30.00"),
          low: decimalString("28.50"),
          close: decimalString("29.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [{ role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(1) }],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.stale).toEqual({ session: "2024-01-01" });
    expect(result.value.legs[0]?.notes).toContainEqual({
      code: "stale_price",
      message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
    });
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

  it("returns invalid_input when a concrete option leg's expiry precedes the session of at", () => {
    const laterAt = "2024-01-05T21:00:00.000Z";
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4C40", "40.00"), expiry: "2024-01-03" }],
    };
    const result = priceOperation(
      {
        view,
        at: laterAt,
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
    expect(result.error.code).toBe("invalid_input");
  });

  it("reads an option leg's strike unadjusted when the view carries no calendar to anchor derivation to (#69 part 2)", () => {
    const view: MarketView = {
      ...baseView,
      calendar: [],
      optionSeries: [callSeries("PETR4C40", "40.00")],
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
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("returns insufficient_data when a concrete option leg's expiry is not in the calendar", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4C40", "40.00"), expiry: "2024-02-01" }],
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
            volatility: decimalString("0.2"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("evaluates a payoff point's pnl at the underlying rounded to PRICE_SCALE, not at the unrounded factor product", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("33.32"), bid: null, ask: null }],
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
            price: decimalString("33.32"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 33.32 * 0.8 = 26.656, which rounds to 26.66 (not truncates to 26.65): the payoff
    // point's own reported `underlying` must be the value pnl was evaluated at, so
    // 100 * (26.66 - 33.32) = -666.00, not 100 * (26.656 - 33.32) = -666.40.
    const point = result.value.payoff.find((p) => p.underlying === decimalString("26.66"));
    expect(point).toBeDefined();
    expect(point?.pnl).toBe(centavos(-666_00));
  });

  it("returns invalid_input when a second stock leg's ticker does not match the inferred underlying", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        ...baseView.quotes,
        { ticker: "VALE3", asOf: at, last: decimalString("60.00"), bid: null, ask: null },
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
            quantity: quantity(100),
            price: decimalString("30.00"),
          },
          {
            role: "stock",
            side: "sell",
            ticker: "VALE3",
            quantity: quantity(100),
            price: decimalString("60.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns invalid_input when two concrete option legs list different expiries", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4C40", "40.00"),
        { ...callSeries("PETR4C42", "42.00"), expiry: "2024-01-14" },
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
            volatility: decimalString("0.2"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C42",
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

  it("surfaces iv_not_converged and below_intrinsic on a leg with an arbitrage-violating market price", () => {
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
            price: decimalString("1.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.fairValue).toBeNull();
    expect(result.value.legs[0]?.notes).toContainEqual({
      code: "iv_not_converged",
      message: "implied volatility did not converge from the visible market price",
    });
    expect(result.value.legs[0]?.notes).toContainEqual({
      code: "below_intrinsic",
      message: "market price is below the model's intrinsic value floor",
    });
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "iv_not_converged" }),
    );
  });

  it("flags iv_not_converged at the operation level instead of silently dropping a priced leg's greeks from the aggregate", () => {
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
          { role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(100) },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(1),
            price: decimalString("1.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[1]?.greeks).toBeNull();
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "iv_not_converged" }),
    );
    expect(result.value.greeks.delta).toBe(decimalString("100.000000"));
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

  it("a long straddle's breakevens sit symmetrically around the strike (call premium == put premium)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }),
        fc.integer({ min: 1, max: 2000 }),
        (strike, premiumCents) => {
          fc.pre(premiumCents / 100 < strike / 2);
          const premium = (premiumCents / 100).toFixed(2);
          const view: MarketView = {
            ...baseView,
            optionSeries: [
              callSeries("PETR4C", String(strike)),
              { ...callSeries("PETR4P", String(strike)), right: "put" },
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
                  ticker: "PETR4C",
                  quantity: quantity(1),
                  price: decimalString(premium),
                },
                {
                  role: "put",
                  side: "buy",
                  ticker: "PETR4P",
                  quantity: quantity(1),
                  price: decimalString(premium),
                },
              ],
            },
            provenanceBase,
          );
          if (!result.ok) return false;
          const breakEvens = result.value.breakEvens.map(Number).sort((a, b) => a - b);
          if (breakEvens.length !== 2) return false;
          const [lower, upper] = breakEvens;
          if (lower === undefined || upper === undefined) return false;
          const lowerGap = strike - lower;
          const upperGap = upper - strike;
          return Math.abs(lowerGap - upperGap) < 1e-6;
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("priceOperation (break-evens on zero-valued plateaus, #135)", () => {
  it("mirrored call pair (buy call40@2.50, sell call40@2.50): payoff is identically 0 -> no break-even (#134)", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
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
            price: decimalString("2.50"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(1),
            price: decimalString("2.50"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([]);
  });

  it("zero-cost conversion (long stock@30, long put30@2.00, short call30@2.00): payoff is a constant 0 -> no break-even", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        callSeries("PETR4C30", "30.00"),
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
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C30",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([]);
  });

  it("constant -R$50 conversion (long stock@30, long put30@51.00, short call30@1.00): payoff is a constant -50 -> no break-even", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        callSeries("PETR4C30", "30.00"),
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
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("51.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C30",
            quantity: quantity(1),
            price: decimalString("1.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([]);
    expect(result.value.maxLoss).toBe(centavos(50_00));
    expect(result.value.maxGain).toBe(centavos(0));
  });

  it("zero-premium butterfly 30/40/50 (buy call30@3, sell 2x call40@3, buy call50@3): payoff is 0,0,10,0 at 0/30/40/50 -> leaves zero at 30, returns to zero at 50", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4C30", "30.00"),
        callSeries("PETR4C40", "40.00"),
        callSeries("PETR4C50", "50.00"),
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
            ticker: "PETR4C30",
            quantity: quantity(1),
            price: decimalString("3.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(2),
            price: decimalString("3.00"),
          },
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C50",
            quantity: quantity(1),
            price: decimalString("3.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("30.00"), decimalString("50.00")]);
  });

  it("zero-premium call spread 30/40 (buy call30@2, sell call40@2): payoff is 0,0,10 at 0/30/40 -> leaves zero at 30 (the real crossing, #135)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C30", "30.00"), callSeries("PETR4C40", "40.00")],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C30",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("30.00")]);
  });

  it("sold put at premium = strike (sell put30@30.00): payoff is s for 0<=s<=30, touching zero only at spot 0", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4P30", "30.00"), right: "put" }],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "put",
            side: "sell",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("30.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("0.00")]);
  });

  it("zero-premium iron condor 25/30/40/45 (all four legs priced at 2.00): payoff is -5,-5,0,0,-5 at 0/25/30/40/45 -> enters zero at 30, leaves at 40", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P25", "25.00"), right: "put" },
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        callSeries("PETR4C40", "40.00"),
        callSeries("PETR4C45", "45.00"),
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P25",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "put",
            side: "sell",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C45",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("30.00"), decimalString("40.00")]);
  });

  it("dedups two crossings less than half a cent apart to one break-even (put30/39.999 credit spread + call40.001/50 credit spread, all @2.00)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        { ...callSeries("PETR4P40A", "39.999"), right: "put" },
        callSeries("PETR4C40B", "40.001"),
        callSeries("PETR4C50", "50.00"),
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "put",
            side: "sell",
            ticker: "PETR4P40A",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40B",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C50",
            quantity: quantity(1),
            price: decimalString("2.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The plateau's true boundaries are 39.999 and 40.001: half a cent apart, both round to
    // 40.00. Without the final dedup this reports ["40.00","40.00"].
    expect(result.value.breakEvens).toEqual([decimalString("40.00")]);
  });

  it("zero-premium long call (buy call40@0.00): unbounded upside touches zero only at its own strike", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
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
            price: decimalString("0.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("40.00")]);
  });

  it("its sell mirror (sell call40@0.00): unbounded downside touches zero only at its own strike", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C40", "40.00")] };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "call",
            side: "sell",
            ticker: "PETR4C40",
            quantity: quantity(1),
            price: decimalString("0.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("40.00")]);
  });

  it("protective put (buy stock@25.00, buy put30@5.00): break-even is the entry price plus the premium, 30.00", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4P30", "30.00"), right: "put" }],
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
            price: decimalString("25.00"),
          },
          {
            role: "put",
            side: "buy",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("5.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("30.00")]);
  });

  it("synthetic long (sell put30@5.00, buy call30@5.00): the single zero touch at the shared strike is reported exactly once", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P30", "30.00"), right: "put" },
        callSeries("PETR4C30", "30.00"),
      ],
    };
    const result = priceOperation(
      {
        view,
        at,
        legs: [
          {
            role: "put",
            side: "sell",
            ticker: "PETR4P30",
            quantity: quantity(1),
            price: decimalString("5.00"),
          },
          {
            role: "call",
            side: "buy",
            ticker: "PETR4C30",
            quantity: quantity(1),
            price: decimalString("5.00"),
          },
        ],
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.breakEvens).toEqual([decimalString("30.00")]);
  });

  it("vertical call spreads (premiums matched about half the time to force a zero-valued plateau): break-evens are never duplicated, and every one that lands on a sampled strike or 0 has a nonzero neighbour on at least one side (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.constantFrom("buy", "sell"),
        fc.constantFrom("buy", "sell"),
        fc.boolean(),
        (
          lowerStrike,
          width,
          lowerPremiumCents,
          upperPremiumCentsRaw,
          lowerSide,
          upperSide,
          matchPremiums,
        ) => {
          const upperStrike = lowerStrike + width;
          const upperPremiumCents = matchPremiums ? lowerPremiumCents : upperPremiumCentsRaw;
          const lowerPremium = (lowerPremiumCents / 100).toFixed(2);
          const upperPremium = (upperPremiumCents / 100).toFixed(2);
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
                  side: lowerSide,
                  ticker: "PETR4CL",
                  quantity: quantity(1),
                  price: decimalString(lowerPremium),
                },
                {
                  role: "call",
                  side: upperSide,
                  ticker: "PETR4CU",
                  quantity: quantity(1),
                  price: decimalString(upperPremium),
                },
              ],
            },
            provenanceBase,
          );
          if (!result.ok) return false;
          const { breakEvens, payoff } = result.value;

          if (new Set(breakEvens).size !== breakEvens.length) return false;

          const signOf = (side: "buy" | "sell") => (side === "buy" ? 1 : -1);
          const callIntrinsic = (spot: Decimal, strike: number) => Decimal.max(spot.sub(strike), 0);
          const valueAt = (spot: Decimal) =>
            callIntrinsic(spot, lowerStrike)
              .sub(lowerPremium)
              .mul(signOf(lowerSide))
              .add(callIntrinsic(spot, upperStrike).sub(upperPremium).mul(signOf(upperSide)));
          const slopeAtInfinity = signOf(lowerSide) + signOf(upperSide);
          const keypoints = [new Decimal(0), new Decimal(lowerStrike), new Decimal(upperStrike)];
          const values = keypoints.map(valueAt);

          for (const be of breakEvens) {
            const point = payoff.find((p) => p.underlying === be);
            if (!point) return false;

            const keypointIndex = keypoints.findIndex(
              (k) => toDecimalString(k, PRICE_SCALE) === be,
            );
            if (keypointIndex === -1) continue;
            const leftNonzero = keypointIndex > 0 && !values[keypointIndex - 1]?.isZero();
            const rightNonzero =
              keypointIndex < keypoints.length - 1
                ? !values[keypointIndex + 1]?.isZero()
                : slopeAtInfinity !== 0;
            if (!leftNonzero && !rightNonzero) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
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

  it("returns unsizeable(unaffordable_budget) when the budget cannot afford one unit (R$100 budget, R$500 per unit)", () => {
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
    expect(result.error).toEqual({ code: "unsizeable", reason: "unaffordable_budget" });
  });

  it("sizes a fixed_fractional zero-net-premium structure against maxLoss, not zero premium (#59)", () => {
    const riskReversalView: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C32", "32.00"),
      ],
      optionPrices: [
        {
          ticker: "PETR4P28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
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
    const riskReversalStructure: Structure = {
      id: "zero-cost-risk-reversal",
      name: "Zero-cost risk reversal",
      expiry: "shared",
      legs: [
        { role: "put", side: "sell", ratio: 1, strikeRank: 1 },
        { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: riskReversalView,
        at,
        legs: {
          structure: riskReversalStructure,
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
    expect(result.value.netPremium).toBe(0);
    if (result.value.maxLoss === "unbounded") throw new Error("maxLoss must be bounded here");
    expect(result.value.maxLoss).toBe(498_400);
    expect(result.value.legs[0]?.leg.quantity).toBe(178);
    expect(result.value.legs[1]?.leg.quantity).toBe(178);
  });

  it("returns unsizeable(unbounded_max_loss) for a fixed_fractional zero-net-premium structure with a naked short call leg (#59)", () => {
    const zeroNetUnboundedView: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C33", "33.00"),
      ],
      optionPrices: [
        {
          ticker: "PETR4P28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C33",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const collarShortStructure: Structure = {
      id: "long-put-short-call",
      name: "Long put, short call",
      expiry: "shared",
      legs: [
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: zeroNetUnboundedView,
        at,
        legs: {
          structure: collarShortStructure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.00") },
            { kind: "nearest", price: decimalString("33.00") },
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "unbounded_max_loss" });
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

  it("sizes a fixed_fractional net-debit structure with a short leg on its bounded max loss, not the premium paid (#131)", () => {
    const boundedDebitView: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C32", "32.00"),
      ],
      optionPrices: [
        {
          ticker: "PETR4P28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const shortPutLongCallStructure: Structure = {
      id: "short-put-long-call",
      name: "Short put, long call",
      expiry: "shared",
      legs: [
        { role: "put", side: "sell", ratio: 1, strikeRank: 1 },
        { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: boundedDebitView,
        at,
        legs: {
          structure: shortPutLongCallStructure,
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
    // Net premium is -R$2.00/unit (buy call 3.00 - sell put 1.00) but the short put's
    // assignment at S = 0 makes the per-unit max loss R$30.00 (strike 28 + the R$2.00
    // debit), not the R$2.00 premium: fixed_fractional must size on the larger figure.
    expect(result.value.netPremium).toBeLessThan(0);
    if (result.value.maxLoss === "unbounded") throw new Error("maxLoss must be bounded here");
    expect(result.value.maxLoss).toBe(166 * 3000);
    expect(result.value.legs[0]?.leg.quantity).toBe(166);
    expect(result.value.legs[1]?.leg.quantity).toBe(166);
    expect(result.value.maxLoss).toBeLessThanOrEqual(5_000_00);
  });

  it("sizes a bounded net-debit structure with a short leg to unsizeable(unaffordable_budget) when the corrected divisor no longer fits the budget (#131)", () => {
    const boundedDebitView: MarketView = {
      ...baseView,
      optionSeries: [
        { ...callSeries("PETR4P28", "28.00"), right: "put" },
        callSeries("PETR4C32", "32.00"),
      ],
      optionPrices: [
        {
          ticker: "PETR4P28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const shortPutLongCallStructure: Structure = {
      id: "short-put-long-call-unaffordable",
      name: "Short put, long call",
      expiry: "shared",
      legs: [
        { role: "put", side: "sell", ratio: 1, strikeRank: 1 },
        { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: boundedDebitView,
        at,
        legs: {
          structure: shortPutLongCallStructure,
          underlying: "PETR4",
          strikes: [
            { kind: "nearest", price: decimalString("28.00") },
            { kind: "nearest", price: decimalString("32.00") },
          ],
          expiry: { kind: "business_days", min: 1, max: 30 },
          quantity: { kind: "fixed_fractional", fraction: decimalString("0.1") },
        },
        riskProfile: {
          declaredCapital: centavos(100_00),
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
    // The R$2.00/unit premium alone (budget R$10.00 / R$2.00 = 5 units) would have sized
    // fine before #131; the R$30.00/unit bounded max loss (R$10.00 / R$30.00 < 1) does not
    // fit the same budget, so the corrected divisor makes this genuinely unsizeable.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "unaffordable_budget" });
  });

  it("sizes a married put (no short leg) on the premium paid, since its bounded max loss stays under the premium (#131)", () => {
    const marriedPutView: MarketView = {
      ...baseView,
      optionSeries: [{ ...callSeries("PETR4P28", "28.00"), right: "put" }],
      optionPrices: [
        {
          ticker: "PETR4P28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const marriedPutStructure: Structure = {
      id: "married-put",
      name: "Married put",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
      ],
    };
    const result = priceOperation(
      {
        view: marriedPutView,
        at,
        legs: {
          structure: marriedPutStructure,
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
    if (result.value.maxLoss === "unbounded") throw new Error("maxLoss must be bounded here");
    // Premium paid is R$31.00/unit (stock 30.00 + put 1.00); the protective put caps the
    // per-unit max loss at R$3.00 (stock falls to 0, put intrinsic 28.00 nets most of it
    // back), strictly under the premium, so unitsFromPerUnit divides by the premium: floor
    // (500000 / 3100) = 161 units, unchanged from before #131 (no short leg here).
    expect(result.value.maxLoss).toBeLessThan(161 * 3100);
    expect(result.value.legs[0]?.leg.quantity).toBe(161);
    expect(result.value.legs[1]?.leg.quantity).toBe(161);
  });

  it("sizes a pure long-call debit structure unchanged by the #131 fix (max loss equals the premium paid)", () => {
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
    if (result.value.maxLoss === "unbounded") throw new Error("maxLoss must be bounded here");
    // Premium is R$3.00/unit; budget is R$5,000: floor(500000 / 300) = 1666 units, the same
    // figure fixed_fractional gave before #131 (a single long call has no short leg, so its
    // max loss equals the premium paid).
    expect(result.value.legs[0]?.leg.quantity).toBe(1666);
    expect(result.value.maxLoss).toBe(1666 * 300);
  });

  it("returns unsizeable(unbounded_max_loss) for a fixed_fractional net-debit ratio spread with unbounded max loss (#131)", () => {
    const unboundedDebitView: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C28", "28.00"), callSeries("PETR4C32", "32.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("5.00"),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C32",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("1.50"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const ratioSpreadStructure: Structure = {
      id: "long-call-short-two-calls",
      name: "Long call, short two calls",
      expiry: "shared",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
      ],
    };
    const result = priceOperation(
      {
        view: unboundedDebitView,
        at,
        legs: {
          structure: ratioSpreadStructure,
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "unsizeable", reason: "unbounded_max_loss" });
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

  it("fixed_fractional never sizes a bounded structure past its declared budget: units × per-unit max loss ≤ capital × fraction (#131)", () => {
    const shortPutLongCallStructure: Structure = {
      id: "short-put-long-call-property",
      name: "Short put, long call",
      expiry: "shared",
      legs: [
        { role: "put", side: "sell", ratio: 1, strikeRank: 1 },
        { role: "call", side: "buy", ratio: 1, strikeRank: 2 },
      ],
    };
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 99 }),
        (putStrike, width, putPremiumCents, callPremiumCents, fractionPercent) => {
          const callStrike = putStrike + width;
          const capital = 10_000_00;
          const propertyView: MarketView = {
            ...baseView,
            optionSeries: [
              { ...callSeries("PETR4PP", String(putStrike)), right: "put" },
              callSeries("PETR4CP", String(callStrike)),
            ],
            optionPrices: [
              {
                ticker: "PETR4PP",
                session: "2024-01-02",
                asOf: at,
                average: null,
                close: decimalString((putPremiumCents / 100).toFixed(2)),
                trades: 1,
                tradedQuantity: 1,
              },
              {
                ticker: "PETR4CP",
                session: "2024-01-02",
                asOf: at,
                average: null,
                close: decimalString((callPremiumCents / 100).toFixed(2)),
                trades: 1,
                tradedQuantity: 1,
              },
            ],
          };
          const result = priceOperation(
            {
              view: propertyView,
              at,
              legs: {
                structure: shortPutLongCallStructure,
                underlying: "PETR4",
                strikes: [
                  { kind: "nearest", price: decimalString(String(putStrike)) },
                  { kind: "nearest", price: decimalString(String(callStrike)) },
                ],
                expiry: { kind: "business_days", min: 1, max: 30 },
                quantity: {
                  kind: "fixed_fractional",
                  fraction: decimalString((fractionPercent / 100).toFixed(2)),
                },
              },
              riskProfile: {
                declaredCapital: centavos(capital),
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
          if (!result.ok) {
            return (
              result.error.code === "unsizeable" && result.error.reason === "unaffordable_budget"
            );
          }
          if (result.value.maxLoss === "unbounded") return false;
          const budget = new Decimal(capital).mul(fractionPercent).div(100);
          return new Decimal(result.value.maxLoss).lte(budget);
        },
      ),
      { numRuns: 200 },
    );
  });
});
