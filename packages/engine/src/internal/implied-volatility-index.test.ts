import { describe, expect, it } from "vitest";
import type { MarketView, OptionSeries, TradingSession } from "../api";
import { bsmPriceRaw } from "./black-scholes";
import { decimalString } from "../test/support";
import { assertDefined } from "./invariant";
import { computeImpliedVolatilityIndex } from "./implied-volatility-index";

function dailyCalendar(fromIso: string, count: number): TradingSession[] {
  const sessions: TradingSession[] = [];
  const cursor = new Date(`${fromIso}T00:00:00.000Z`);
  for (let i = 0; i < count; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    sessions.push({
      date,
      open: `${date}T13:00:00.000Z`,
      close: `${date}T21:00:00.000Z`,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return sessions;
}

const calendar = dailyCalendar("2024-01-01", 60);
function sessionAt(index: number): TradingSession {
  return assertDefined(calendar[index], "calendar index out of bounds");
}
const at = sessionAt(0).close;

function callSeries(ticker: string, strike: string, expiry: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right: "call",
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf: at,
  };
}

const testProvenanceBase = {
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
  quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("50.00"), bid: null, ask: null }],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

describe("computeImpliedVolatilityIndex", () => {
  it("returns missing_instrument when the underlying has no visible spot", () => {
    const view: MarketView = { ...baseView, quotes: [] };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result).toEqual({ ok: false, error: { code: "missing_instrument", ticker: "PETR4" } });
  });

  it("derives spot from a bid/ask mid quote when no last is visible", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        {
          ticker: "PETR4",
          asOf: at,
          last: null,
          bid: decimalString("49.50"),
          ask: decimalString("50.50"),
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
  });

  it("falls back to the latest visible D1 candle close for spot when no quote is visible", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [],
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: sessionAt(0).date,
          asOf: "2023-12-31T21:00:00.000Z",
          open: decimalString("48.00"),
          high: decimalString("49.00"),
          low: decimalString("47.50"),
          close: decimalString("48.50"),
          tradedQuantity: 500,
        },
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: sessionAt(0).date,
          asOf: at,
          open: decimalString("49.00"),
          high: decimalString("51.00"),
          low: decimalString("48.50"),
          close: decimalString("50.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
  });

  it("rejects a calendar that lists a session twice as invalid_input (#40)", () => {
    const view: MarketView = { ...baseView, calendar: [...calendar, sessionAt(3)] };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        path: "view.calendar",
        message: `duplicate calendar date ${sessionAt(3).date}`,
      },
    });
  });

  it("returns insufficient_data when the calendar has no session open at or before at", () => {
    const view: MarketView = { ...baseView, calendar: [] };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("reports iv_index_not_bracketed with a null impliedVolatility when no series are listed", () => {
    const result = computeImpliedVolatilityIndex(baseView, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).toBeNull();
    expect(result.value.notes).toContainEqual(
      expect.objectContaining({ code: "iv_index_not_bracketed" }),
    );
  });

  it("solves the index alone from a single listed expiry that lands exactly at 30 calendar days", () => {
    const expiry = sessionAt(30).date;
    const trueSigma = 0.3;
    const price = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 30 / 252,
      r: 0,
      q: 0,
      sigma: trueSigma,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C50", "50.00", expiry)],
      optionPrices: [
        {
          ticker: "PETR4C50",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).not.toBeNull();
    expect(Number(result.value.impliedVolatility)).toBeCloseTo(trueSigma, 1);
    expect(result.value.method).toBe("atm_30d_variance_interpolated");
    expect(result.value.seriesUsed).toEqual(["PETR4C50"]);
  });

  it("brackets the same listed expiry the same way whether evaluated at the session's open or its close", () => {
    const expiry = sessionAt(30).date;
    const trueSigma = 0.3;
    const atOpen = sessionAt(0).open;
    const price = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 31 / 252,
      r: 0,
      q: 0,
      sigma: trueSigma,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: atOpen, last: decimalString("50.00"), bid: null, ask: null },
      ],
      optionSeries: [{ ...callSeries("PETR4C50", "50.00", expiry), asOf: atOpen }],
      optionPrices: [
        {
          ticker: "PETR4C50",
          session: sessionAt(0).date,
          asOf: atOpen,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", atOpen, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes).toEqual([]);
    expect(result.value.impliedVolatility).not.toBeNull();
    expect(Number(result.value.impliedVolatility)).toBeCloseTo(trueSigma, 1);
  });

  it("interpolates linearly in total variance between two bracketing expiries", () => {
    const expiryLower = sessionAt(20).date;
    const expiryUpper = sessionAt(40).date;
    const sigmaLower = 0.2;
    const sigmaUpper = 0.4;
    const priceLower = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 20 / 252,
      r: 0,
      q: 0,
      sigma: sigmaLower,
      right: "call",
    });
    const priceUpper = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 40 / 252,
      r: 0,
      q: 0,
      sigma: sigmaUpper,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CL", "50.00", expiryLower),
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices: [
        {
          ticker: "PETR4CL",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(priceLower.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4CU",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(priceUpper.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).not.toBeNull();
    const index = Number(result.value.impliedVolatility);
    // T1=20/252, T2=40/252, T30=30/252, so w=(T2-T30)/(T2-T1)=0.5: the closed-form
    // variance-linear index is sqrt((w * sigmaLower^2 * T1 + (1-w) * sigmaUpper^2 * T2) / T30),
    // which the 252-session basis reduces to sqrt((0.04*20 + 0.16*40) / (2*30)) = sqrt(0.12),
    // to the precision the two-cent-rounded fixture prices solve back to.
    expect(index).toBeCloseTo(Math.sqrt(0.12), 3);
    expect(index).toBeGreaterThan(sigmaLower);
    expect(index).toBeLessThan(sigmaUpper);
    expect(result.value.seriesUsed.sort()).toEqual(["PETR4CL", "PETR4CU"]);
  });

  it("reports iv_index_not_bracketed when the exact-30-day expiry has no visible price", () => {
    const expiry = sessionAt(30).date;
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C50", "50.00", expiry)],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).toBeNull();
  });

  it("reports iv_index_not_bracketed when every listed expiry is on the same side of 30 days", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries("PETR4C50", "50.00", sessionAt(10).date)],
      optionPrices: [
        {
          ticker: "PETR4C50",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString("1.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).toBeNull();
  });

  it("reports iv_index_not_bracketed when one bracketing expiry has no visible price", () => {
    const expiryLower = sessionAt(20).date;
    const expiryUpper = sessionAt(40).date;
    const priceLower = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 20 / 252,
      r: 0,
      q: 0,
      sigma: 0.2,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CL", "50.00", expiryLower),
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices: [
        {
          ticker: "PETR4CL",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(priceLower.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.impliedVolatility).toBeNull();
  });

  it("breaks a nearest-strike ATM tie by the lower strike", () => {
    const expiry = sessionAt(30).date;
    const price = bsmPriceRaw({
      s: 50,
      k: 48,
      t: 30 / 252,
      r: 0,
      q: 0,
      sigma: 0.25,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4C52", "52.00", expiry),
        callSeries("PETR4C48", "48.00", expiry),
      ],
      optionPrices: [
        {
          ticker: "PETR4C52",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C48",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.seriesUsed).toEqual(["PETR4C48"]);
  });

  it("ignores a superseded strike row and matches the fresh-only view (round 4 item 1)", () => {
    const expiryLower = sessionAt(20).date;
    const expiryUpper = sessionAt(40).date;
    const sigmaLower = 0.2;
    const sigmaUpper = 0.4;
    const priceLower = bsmPriceRaw({
      s: 45,
      k: 50,
      t: 20 / 252,
      r: 0,
      q: 0,
      sigma: sigmaLower,
      right: "call",
    });
    const priceUpper = bsmPriceRaw({
      s: 45,
      k: 50,
      t: 40 / 252,
      r: 0,
      q: 0,
      sigma: sigmaUpper,
      right: "call",
    });
    const staleAsOf = `${sessionAt(0).date}T12:00:00.000Z`;
    const optionPrices = [
      {
        ticker: "PETR4CL",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(priceLower.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
      {
        ticker: "PETR4CU",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(priceUpper.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
    ];
    const spotQuote = [
      { ticker: "PETR4", asOf: at, last: decimalString("45.00"), bid: null, ask: null },
    ];
    const freshOnlyView: MarketView = {
      ...baseView,
      quotes: spotQuote,
      optionSeries: [
        callSeries("PETR4CL", "50.00", expiryLower),
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices,
    };
    const supersededView: MarketView = {
      ...baseView,
      quotes: spotQuote,
      optionSeries: [
        { ...callSeries("PETR4CL", "45.00", expiryLower), asOf: staleAsOf },
        callSeries("PETR4CL", "50.00", expiryLower),
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices,
    };
    const reversedSupersededView: MarketView = {
      ...supersededView,
      optionSeries: [...supersededView.optionSeries].reverse(),
    };
    const freshResult = computeImpliedVolatilityIndex(
      freshOnlyView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    const supersededResult = computeImpliedVolatilityIndex(
      supersededView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    const reversedSupersededResult = computeImpliedVolatilityIndex(
      reversedSupersededView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    expect(freshResult).toEqual(supersededResult);
    expect(freshResult).toEqual(reversedSupersededResult);
    expect(supersededResult.ok).toBe(true);
    if (!supersededResult.ok) return;
    expect(new Set(supersededResult.value.seriesUsed).size).toBe(
      supersededResult.value.seriesUsed.length,
    );
  });

  it("ignores a superseded expiry row so one ticker never backs both brackets (round 4 item 1)", () => {
    const expiryLower = sessionAt(20).date;
    const staleExpiry = sessionAt(25).date;
    const expiryUpper = sessionAt(40).date;
    const sigmaLower = 0.2;
    const sigmaUpper = 0.4;
    const priceLower = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 20 / 252,
      r: 0,
      q: 0,
      sigma: sigmaLower,
      right: "call",
    });
    const priceUpper = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 40 / 252,
      r: 0,
      q: 0,
      sigma: sigmaUpper,
      right: "call",
    });
    const staleAsOf = `${sessionAt(0).date}T12:00:00.000Z`;
    const optionPrices = [
      {
        ticker: "PETR4CL",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(priceLower.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
      {
        ticker: "PETR4CU",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(priceUpper.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
    ];
    const freshOnlyView: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CL", "50.00", expiryLower),
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices,
    };
    const supersededView: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CL", "50.00", expiryLower),
        { ...callSeries("PETR4CU", "50.00", staleExpiry), asOf: staleAsOf },
        callSeries("PETR4CU", "50.00", expiryUpper),
      ],
      optionPrices,
    };
    const reversedSupersededView: MarketView = {
      ...supersededView,
      optionSeries: [...supersededView.optionSeries].reverse(),
    };
    const freshResult = computeImpliedVolatilityIndex(
      freshOnlyView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    const supersededResult = computeImpliedVolatilityIndex(
      supersededView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    const reversedSupersededResult = computeImpliedVolatilityIndex(
      reversedSupersededView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    expect(freshResult).toEqual(supersededResult);
    expect(freshResult).toEqual(reversedSupersededResult);
    expect(supersededResult.ok).toBe(true);
    if (!supersededResult.ok) return;
    expect(new Set(supersededResult.value.seriesUsed).size).toBe(
      supersededResult.value.seriesUsed.length,
    );
  });

  it("breaks a nearest-strike ATM tie by the numeric strike, not a lexicographic string compare (round 5 item 1)", () => {
    const expiry = sessionAt(30).date;
    const price = bsmPriceRaw({
      s: 10,
      k: 9,
      t: 30 / 252,
      r: 0,
      q: 0,
      sigma: 0.25,
      right: "call",
    });
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("10.00"), bid: null, ask: null }],
      optionSeries: [
        callSeries("PETR4C11", "11.00", expiry),
        callSeries("PETR4C9", "9.00", expiry),
      ],
      optionPrices: [
        {
          ticker: "PETR4C11",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
        {
          ticker: "PETR4C9",
          session: sessionAt(0).date,
          asOf: at,
          average: null,
          close: decimalString(price.toFixed(2)),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const result = computeImpliedVolatilityIndex(view, "PETR4", at, testProvenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.seriesUsed).toEqual(["PETR4C9"]);
  });

  it("breaks a two-ticker tie at one ATM strike by the lexicographically earlier ticker, regardless of array order (round 5 item 1)", () => {
    const expiry = sessionAt(30).date;
    const price = bsmPriceRaw({
      s: 50,
      k: 50,
      t: 30 / 252,
      r: 0,
      q: 0,
      sigma: 0.25,
      right: "call",
    });
    const optionPrices = [
      {
        ticker: "PETR4CA",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(price.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
      {
        ticker: "PETR4CB",
        session: sessionAt(0).date,
        asOf: at,
        average: null,
        close: decimalString(price.toFixed(2)),
        trades: 1,
        tradedQuantity: 1,
      },
    ];
    const orderedView: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CA", "50.00", expiry),
        callSeries("PETR4CB", "50.00", expiry),
      ],
      optionPrices,
    };
    const reversedView: MarketView = {
      ...baseView,
      optionSeries: [
        callSeries("PETR4CB", "50.00", expiry),
        callSeries("PETR4CA", "50.00", expiry),
      ],
      optionPrices,
    };
    const orderedResult = computeImpliedVolatilityIndex(
      orderedView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    const reversedResult = computeImpliedVolatilityIndex(
      reversedView,
      "PETR4",
      at,
      testProvenanceBase,
    );
    expect(orderedResult).toEqual(reversedResult);
    expect(orderedResult.ok).toBe(true);
    if (!orderedResult.ok) return;
    expect(orderedResult.value.seriesUsed).toEqual(["PETR4CA"]);
  });
});
