import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { LegInput, LegValuation, MarketView, OptionSeries } from "../api";
import { dailyCalendar, decimalString, quantity } from "../test/support";
import { priceOperation, type PricedLeg } from "./price-operation";
import { computeProbabilityOfProfit } from "./probability-of-profit";

// ADR-0082's shared fixture: spot 30.00, a CDI point at 0.15 (r = ln(1.15) = "0.139762"),
// q = 0 (no dividend yield visible), priced 21 sessions before a 2024-01-22 expiry, every
// option leg given a volatility of 0.30 and a given price (decoupling sigma from the premium).
const calendar = dailyCalendar(1, 60);
const at = "2024-01-01T21:00:00.000Z";
const expiry = "2024-01-22";
const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

function series(
  ticker: string,
  right: "call" | "put",
  strike: string,
  options: { priceFactor?: string; expiry?: string; underlying?: string } = {},
): OptionSeries {
  return {
    ticker,
    underlying: options.underlying ?? "VALE3",
    right,
    strike: decimalString(strike),
    expiry: options.expiry ?? expiry,
    style: "european",
    asOf: at,
    ...(options.priceFactor ? { priceFactor: decimalString(options.priceFactor) } : {}),
  };
}

function viewAt(
  spot: string,
  optionSeries: OptionSeries[],
  options: { cdi?: string; underlying?: string } = {},
): MarketView {
  const underlying = options.underlying ?? "VALE3";
  return {
    calendar,
    candles: [],
    corporateActions: [],
    optionSeries,
    optionPrices: [],
    quotes: [{ ticker: underlying, asOf: at, last: decimalString(spot), bid: null, ask: null }],
    macro: [
      {
        series: "cdi",
        date: "2024-01-01",
        asOf: at,
        annualRate: decimalString(options.cdi ?? "0.15"),
      },
    ],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
}

function option(
  ticker: string,
  right: "call" | "put",
  side: "buy" | "sell",
  price: string,
  quantityUnits = 1,
  volatility = "0.30",
): LegInput {
  return {
    role: right,
    side,
    ticker,
    quantity: quantity(quantityUnits),
    price: decimalString(price),
    volatility: decimalString(volatility),
  };
}

function stock(
  ticker: string,
  side: "buy" | "sell",
  price: string,
  quantityUnits: number,
): LegInput {
  return {
    role: "stock",
    side,
    ticker,
    quantity: quantity(quantityUnits),
    price: decimalString(price),
  };
}

function probabilityOf(view: MarketView, legs: LegInput[], atOverride = at) {
  const result = priceOperation({ view, at: atOverride, legs }, provenanceBase);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.probabilityOfProfit;
}

describe("probabilityOfProfit (ADR-0082 reference table)", () => {
  it("test 1: long call 30 @ 1.20 -> 0.3588", () => {
    const view = viewAt("30.00", [series("VALE3C30", "call", "30.00")]);
    const p = probabilityOf(view, [option("VALE3C30", "call", "buy", "1.20")]);
    expect(p?.probability).toBe("0.3588");
  });

  it("test 2: long put 30 @ 0.90 -> 0.3289", () => {
    const view = viewAt("30.00", [series("VALE3P30", "put", "30.00")]);
    const p = probabilityOf(view, [option("VALE3P30", "put", "buy", "0.90")]);
    expect(p?.probability).toBe("0.3289");
  });

  it("test 3: short call 30 @ 1.20 -> 0.6412, complements test 1", () => {
    const view = viewAt("30.00", [series("VALE3C30", "call", "30.00")]);
    const p = probabilityOf(view, [option("VALE3C30", "call", "sell", "1.20")]);
    expect(p?.probability).toBe("0.6412");
  });

  it("test 4: bull call spread 30/33 -> 0.4085", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "1.20"),
      option("VALE3C33", "call", "sell", "0.35"),
    ]);
    expect(p?.probability).toBe("0.4085");
  });

  it("test 5: zero-cost bull call spread 30/33 -> the literal N(d2) at 0.5363", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "0.50"),
      option("VALE3C33", "call", "sell", "0.50"),
    ]);
    expect(p?.probability).toBe("0.5363");
  });

  it("test 6: iron condor -> 0.6854", () => {
    const view = viewAt("30.00", [
      series("VALE3P28", "put", "28.00"),
      series("VALE3P26", "put", "26.00"),
      series("VALE3C32", "call", "32.00"),
      series("VALE3C34", "call", "34.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3P28", "put", "sell", "0.40"),
      option("VALE3P26", "put", "buy", "0.12"),
      option("VALE3C32", "call", "sell", "0.50"),
      option("VALE3C34", "call", "buy", "0.15"),
    ]);
    expect(p?.probability).toBe("0.6854");
  });

  it("test 6 again: both tied short strikes count for sigma", () => {
    const view = viewAt("30.00", [
      series("VALE3P28", "put", "28.00"),
      series("VALE3P26", "put", "26.00"),
      series("VALE3C32", "call", "32.00"),
      series("VALE3C34", "call", "34.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3P28", "put", "sell", "0.40"),
      option("VALE3P26", "put", "buy", "0.12"),
      option("VALE3C32", "call", "sell", "0.50"),
      option("VALE3C34", "call", "buy", "0.15"),
    ]);
    expect(p?.volatilityFrom).toEqual(["VALE3C32", "VALE3P28"]);
  });

  it("test 7: long straddle -> 0.4215", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3P30", "put", "30.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "1.20"),
      option("VALE3P30", "put", "buy", "0.90"),
    ]);
    expect(p?.probability).toBe("0.4215");
  });

  it("test 8: covered call -> 0.6123, sigma from the call", () => {
    const view = viewAt("30.00", [series("VALE3C32", "call", "32.00")]);
    const p = probabilityOf(view, [
      stock("VALE3", "buy", "30.00", 100),
      option("VALE3C32", "call", "sell", "0.50", 100),
    ]);
    expect(p?.probability).toBe("0.6123");
    expect(p?.volatilityFrom).toEqual(["VALE3C32"]);
  });

  it("test 9: zero plateau at the width of the debit -> 0.0000", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "3.20"),
      option("VALE3C33", "call", "sell", "0.20"),
    ]);
    expect(p?.probability).toBe("0.0000");
  });

  it("test 10: always profit (a net credit) -> 1.0000", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "0.20"),
      option("VALE3C33", "call", "sell", "0.50"),
    ]);
    expect(p?.probability).toBe("1.0000");
  });

  it("test 11: test 1 scaled to one lot (quantity x 100) is unchanged", () => {
    const view = viewAt("30.00", [series("VALE3C30", "call", "30.00")]);
    const p = probabilityOf(view, [option("VALE3C30", "call", "buy", "1.20", 100)]);
    expect(p?.probability).toBe("0.3588");
  });

  it("test 12: stock only -> null", () => {
    const view = viewAt("30.00", []);
    const p = probabilityOf(view, [stock("VALE3", "buy", "30.00", 100)]);
    expect(p).toBeNull();
  });

  it("test 13: spot at the break-even, one session to expiry -> 0.5079", () => {
    const view = viewAt("31.20", [series("VALE3C30", "call", "30.00", { expiry: "2024-01-02" })]);
    const p = probabilityOf(view, [option("VALE3C30", "call", "buy", "1.20")]);
    expect(p?.probability).toBe("0.5079");
  });
});

describe("probabilityOfProfit sigma rule and fallback (ADR-0082)", () => {
  it("at spot 30, sigma comes from the 30 call alone", () => {
    const view = viewAt("30.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "1.00", 1, "0.25"),
      option("VALE3C33", "call", "sell", "0.30", 1, "0.35"),
    ]);
    expect(p?.volatility).toBe("0.250000");
    expect(p?.volatilityFrom).toEqual(["VALE3C30"]);
  });

  it("at spot 31.50, equidistant strikes average sigma and both tickers sort", () => {
    const view = viewAt("31.50", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      option("VALE3C30", "call", "buy", "1.00", 1, "0.25"),
      option("VALE3C33", "call", "sell", "0.30", 1, "0.35"),
    ]);
    expect(p?.volatility).toBe("0.300000");
    expect(p?.volatilityFrom).toEqual(["VALE3C30", "VALE3C33"]);
  });

  it("falls back to the next-nearest leg with a model when the nearer one has none", () => {
    const view = viewAt("31.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      {
        role: "call",
        side: "buy",
        ticker: "VALE3C30",
        quantity: quantity(1),
        price: decimalString("0.90"),
      },
      option("VALE3C33", "call", "sell", "0.30", 1, "0.35"),
    ]);
    expect(p?.volatility).toBe("0.350000");
    expect(p?.volatilityFrom).toEqual(["VALE3C33"]);
  });

  it("is null for a single-option operation whose only leg has no model", () => {
    const view = viewAt("31.00", [series("VALE3C30", "call", "30.00")]);
    const p = probabilityOf(view, [
      {
        role: "call",
        side: "buy",
        ticker: "VALE3C30",
        quantity: quantity(1),
        price: decimalString("0.90"),
      },
    ]);
    expect(p).toBeNull();
  });

  it("is null when another leg has sigma but one leg has neither price nor fair value", () => {
    const view = viewAt("31.00", [
      series("VALE3C30", "call", "30.00"),
      series("VALE3C33", "call", "33.00"),
    ]);
    const p = probabilityOf(view, [
      { role: "call", side: "buy", ticker: "VALE3C30", quantity: quantity(1) },
      option("VALE3C33", "call", "sell", "0.30", 1, "0.35"),
    ]);
    expect(p).toBeNull();
  });
});

describe("probabilityOfProfit index options and null cases (ADR-0082)", () => {
  it("gives the same probability as the same strikes and spot priced as a stock option with each premium divided by the price factor (ADR-0063)", () => {
    const stockView = viewAt("30.00", [series("VALE3C30", "call", "30.00")]);
    const stockP = probabilityOf(stockView, [option("VALE3C30", "call", "buy", "1.20")]);

    const indexView = viewAt(
      "30.00",
      [series("IBOV30", "call", "30.00", { priceFactor: "100", underlying: "IBOV" })],
      { underlying: "IBOV" },
    );
    const indexP = probabilityOf(indexView, [option("IBOV30", "call", "buy", "0.0120")]);

    expect(indexP?.probability).toBe(stockP?.probability);
  });

  it("is null at T = 0 (priced at the expiry session's close)", () => {
    const view = viewAt("31.20", [series("VALE3C30", "call", "30.00", { expiry: "2024-01-01" })]);
    const p = probabilityOf(view, [option("VALE3C30", "call", "buy", "1.20")]);
    expect(p).toBeNull();
  });
});

describe("computeProbabilityOfProfit (internal, mixed expiries)", () => {
  function dummyValuation(
    role: "call" | "put" | "stock",
    side: "buy" | "sell",
    ticker: string,
    qty: number,
  ): LegValuation {
    return {
      leg: { role, side, ticker, quantity: quantity(qty) },
      price: decimalString("1.00"),
      priceSource: "given",
      stale: null,
      fairValue: null,
      impliedVolatility: null,
      volatilitySource: null,
      greeks: null,
      timeToExpiryYears: null,
      notes: [],
    };
  }

  function modeledLeg(args: {
    right: "call" | "put";
    side: "buy" | "sell";
    ticker: string;
    strike: string;
    premium: string;
    sigma: number;
    t: number;
  }): PricedLeg {
    return {
      valuation: dummyValuation(args.right, args.side, args.ticker, 1),
      strike: decimalString(args.strike),
      premiumPerUnit: new Decimal(args.premium),
      priceFactor: new Decimal(1),
      model: { sigma: args.sigma, timeToExpiryYears: args.t },
    };
  }

  it("is null when the option legs' timeToExpiryYears differ", () => {
    const legs = [
      modeledLeg({
        right: "call",
        side: "buy",
        ticker: "VALE3C30",
        strike: "30.00",
        premium: "1.20",
        sigma: 0.3,
        t: 21 / 252,
      }),
      modeledLeg({
        right: "call",
        side: "sell",
        ticker: "VALE3C33",
        strike: "33.00",
        premium: "0.35",
        sigma: 0.35,
        t: 42 / 252,
      }),
    ];
    const result = computeProbabilityOfProfit(
      legs,
      decimalString("30.00"),
      [decimalString("30.85")],
      decimalString("0.139762"),
      decimalString("0"),
    );
    expect(result).toBeNull();
  });

  it("is invariant to the order the legs are given in", () => {
    const callLeg = modeledLeg({
      right: "call",
      side: "buy",
      ticker: "VALE3C30",
      strike: "30.00",
      premium: "1.20",
      sigma: 0.3,
      t: 21 / 252,
    });
    const putLeg = modeledLeg({
      right: "put",
      side: "buy",
      ticker: "VALE3P30",
      strike: "30.00",
      premium: "0.90",
      sigma: 0.3,
      t: 21 / 252,
    });
    const breakEvens = [decimalString("27.90"), decimalString("32.10")];
    const forward = computeProbabilityOfProfit(
      [callLeg, putLeg],
      decimalString("30.00"),
      breakEvens,
      decimalString("0.139762"),
      decimalString("0"),
    );
    const reversed = computeProbabilityOfProfit(
      [putLeg, callLeg],
      decimalString("30.00"),
      breakEvens,
      decimalString("0.139762"),
      decimalString("0"),
    );
    expect(forward).toEqual(reversed);
  });
});
