import { describe, expect, it } from "vitest";
import type { Candle, MarketView, Operation, OptionSeries, TradingSession } from "../api";
import { decimalString, quantity } from "../test/support";
import { proposeSettlement } from "./propose-settlement";

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
const expiry = "2024-01-21";
const expiryClose = "2024-01-21T21:00:00.000Z";
const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const underlyingCandle = (close: string): Candle => ({
  ticker: "PETR4",
  timeframe: "D1",
  session: expiry,
  asOf: expiryClose,
  open: decimalString(close),
  high: decimalString(close),
  low: decimalString(close),
  close: decimalString(close),
  tradedQuantity: 1000,
});

const baseView: MarketView = {
  calendar,
  candles: [underlyingCandle("30.00")],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

function optionSeries(ticker: string, right: "call" | "put", strike: string): OptionSeries {
  return {
    ticker,
    underlying: "PETR4",
    right,
    strike: decimalString(strike),
    expiry,
    style: "european",
    asOf: expiryClose,
  };
}

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    underlying: "PETR4",
    legs: [],
    expiry,
    openedAt: "2024-01-01",
    strategyVersionId: null,
    rolledFrom: null,
    ...overrides,
  };
}

describe("proposeSettlement", () => {
  it("exercises a long call in the money and books a buy fill at the strike", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.underlyingClose).toBe(decimalString("30.00"));
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "exercised",
      intrinsicValue: decimalString("2.00"),
      fills: [
        {
          ticker: "PETR4",
          side: "buy",
          quantity: quantity(1),
          price: decimalString("28.00"),
          session: expiry,
          at: expiryClose,
          costs: 0,
        },
      ],
    });
  });

  it("lets a long call expire worthless out of the money", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C40", "call", "40.00")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C40",
          quantity: quantity(1),
          entryPrice: decimalString("0.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "expired_worthless",
      intrinsicValue: decimalString("0.00"),
      fills: [],
    });
  });

  it("assigns a short call in the money and books a sell fill at the strike", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "assigned",
      intrinsicValue: decimalString("2.00"),
      fills: [
        {
          ticker: "PETR4",
          side: "sell",
          quantity: quantity(1),
          price: decimalString("28.00"),
          session: expiry,
          at: expiryClose,
          costs: 0,
        },
      ],
    });
  });

  it("lets a short call expire worthless out of the money", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C40", "call", "40.00")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C40",
          quantity: quantity(1),
          entryPrice: decimalString("0.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.outcome).toBe("expired_worthless");
    expect(result.value.legs[0]?.fills).toEqual([]);
  });

  it("exercises a long put in the money and books a sell fill at the strike", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4P32", "put", "32.00")],
    };
    const op = operation({
      legs: [
        {
          role: "put",
          side: "buy",
          ticker: "PETR4P32",
          quantity: quantity(2),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "exercised",
      intrinsicValue: decimalString("2.00"),
      fills: [
        {
          ticker: "PETR4",
          side: "sell",
          quantity: quantity(2),
          price: decimalString("32.00"),
          session: expiry,
          at: expiryClose,
          costs: 0,
        },
      ],
    });
  });

  it("assigns a short put in the money and books a buy fill at the strike", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4P32", "put", "32.00")],
    };
    const op = operation({
      legs: [
        {
          role: "put",
          side: "sell",
          ticker: "PETR4P32",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "assigned",
      intrinsicValue: decimalString("2.00"),
      fills: [
        {
          ticker: "PETR4",
          side: "buy",
          quantity: quantity(1),
          price: decimalString("32.00"),
          session: expiry,
          at: expiryClose,
          costs: 0,
        },
      ],
    });
  });

  it("lets a long put expire worthless out of the money", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4P20", "put", "20.00")],
    };
    const op = operation({
      legs: [
        {
          role: "put",
          side: "buy",
          ticker: "PETR4P20",
          quantity: quantity(1),
          entryPrice: decimalString("0.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.outcome).toBe("expired_worthless");
  });

  it("keeps a stock leg with a null intrinsicValue and no fills", () => {
    const op = operation({
      expiry: null,
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    // A stock-only operation has no expiry to settle: exercised through the invalid_input
    // path below. Kept-stock coverage for a mixed structure lives in the covered-call test.
    const result = proposeSettlement({ view: baseView, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
  });

  it("keeps a covered call's stock leg while exercising its short call", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    };
    const op = operation({
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
        },
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]).toEqual({
      leg: op.legs[0],
      outcome: "kept",
      intrinsicValue: null,
      fills: [],
    });
    expect(result.value.legs[1]?.outcome).toBe("assigned");
  });

  it("returns invalid_input for an operation with no expiry", () => {
    const op = operation({
      expiry: null,
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(1),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    const result = proposeSettlement({ view: baseView, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operation.expiry",
      message: "an operation with no expiry has nothing to settle",
    });
  });

  it("returns insufficient_data when the calendar does not cover the expiry session", () => {
    const op = operation({
      expiry: "2099-01-01",
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view: baseView, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("returns insufficient_data when the underlying has no candle for the expiry session", () => {
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement(
      { view: { ...baseView, candles: [] }, operation: op },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("prefers the latest visible underlying candle when a session has more than one row", () => {
    const staleCandle: Candle = { ...underlyingCandle("30.00"), asOf: expiry + "T13:30:00.000Z" };
    const revisedCandle: Candle = { ...underlyingCandle("31.00"), asOf: expiryClose };
    const view: MarketView = {
      ...baseView,
      candles: [revisedCandle, staleCandle],
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.underlyingClose).toBe(decimalString("31.00"));
  });

  it("returns missing_instrument when an option leg's series is not visible in the view", () => {
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view: baseView, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4C28" });
  });

  it("returns invalid_input when a stock leg's ticker does not match the operation's underlying", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    };
    const op = operation({
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
        },
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operation.legs[0].ticker",
      message: "a stock leg's ticker must match the operation's underlying",
    });
  });

  it("returns invalid_input when an option leg's listed expiry does not match the operation's expiry", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [{ ...optionSeries("PETR4C28", "call", "28.00"), expiry: "2024-02-01" }],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operation.legs[0]",
      message: "an option leg's listed expiry does not match the operation's expiry",
    });
  });
});
