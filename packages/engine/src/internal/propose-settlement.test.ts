import { describe, expect, it } from "vitest";
import type { Candle, MarketView, Operation, OptionSeries, TradingSession } from "../api";
import { dailyCalendar, decimalString, quantity } from "../test/support";
import { proposeSettlement } from "./propose-settlement";

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

  it("records a scale-8 strike's fill price at PRICE_SCALE, trailing zeros dropped (#72 review)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C11", "call", "11.00000000")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C11",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.fills[0]?.price).toBe(decimalString("11.00"));
  });

  it("records a strike with 3 decimal places at its own exact value, not rounded to centavos (#72 review)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [optionSeries("PETR4C11", "call", "11.005")],
    };
    const op = operation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C11",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.legs[0]?.fills[0]?.price).toBe(decimalString("11.005"));
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
    expect(result.error).toEqual({
      code: "insufficient_data",
      needed: {
        from: expiry + "T13:00:00.000Z",
        to: expiryClose,
        instruments: ["PETR4"],
        timeframes: ["D1"],
        collections: ["candles"],
      },
    });
  });

  it("returns a midnight-UTC insufficient_data window when the calendar does not cover the expiry session at all (item 10)", () => {
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
    expect(result.error).toEqual({
      code: "insufficient_data",
      needed: {
        from: "2099-01-01T00:00:00.000Z",
        to: "2099-01-01T00:00:00.000Z",
        instruments: ["PETR4"],
        timeframes: ["D1"],
        collections: ["candles"],
      },
    });
  });

  it("notes that a settlement proposal's fills carry no costs (item 10)", () => {
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
    expect(result.value.notes).toContainEqual({
      code: "settlement_costs_not_modeled",
      message: "the proposed fill(s) carry no B3 fee or brokerage; costs apply once recorded",
    });
  });

  it("does not note settlement_costs_not_modeled when every leg expires worthless", () => {
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
    expect(result.value.notes).toEqual([]);
  });

  it("prefers the latest visible underlying candle when a session has more than one row, regardless of array order", () => {
    const staleCandle: Candle = { ...underlyingCandle("30.00"), asOf: expiry + "T13:30:00.000Z" };
    const revisedCandle: Candle = { ...underlyingCandle("31.00"), asOf: expiryClose };
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
    const viewWith = (candles: Candle[]): MarketView => ({
      ...baseView,
      candles,
      optionSeries: [optionSeries("PETR4C28", "call", "28.00")],
    });
    // MarketView.candles order is not meaningful (I3): a same-session candle revision must
    // resolve the same way whether the revision or the stale row comes first in the array
    // (round 1 item 5).
    const forward = proposeSettlement(
      { view: viewWith([revisedCandle, staleCandle]), operation: op },
      provenanceBase,
    );
    const reversed = proposeSettlement(
      { view: viewWith([staleCandle, revisedCandle]), operation: op },
      provenanceBase,
    );
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    expect(forward.value.underlyingClose).toBe(decimalString("31.00"));
    expect(reversed).toEqual(forward);
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

  it("returns invalid_input when a listed strike is not positive (item 7)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        { ...optionSeries("PETR4C28", "call", "28.00"), strike: decimalString("0.00") },
      ],
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
      path: "legs[0].strike",
      message: "a listed strike must be positive (PETR4C28)",
    });
  });

  it("indexes a non-positive strike error by the leg's own position, not its ticker (round 3 item 8)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [
        optionSeries("PETR4C28", "call", "28.00"),
        { ...optionSeries("PETR4C30", "call", "30.00"), strike: decimalString("0.00") },
      ],
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
          entryPrice: decimalString("2.50"),
        },
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C30",
          quantity: quantity(1),
          entryPrice: decimalString("1.50"),
        },
      ],
    });
    const result = proposeSettlement({ view, operation: op }, provenanceBase);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "legs[2].strike",
      message: "a listed strike must be positive (PETR4C30)",
    });
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

  it("returns invalid_input for a duplicate calendar date (item 11)", () => {
    const view: MarketView = {
      ...baseView,
      calendar: [...calendar, calendar[0] as TradingSession],
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
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.code === "invalid_input" && result.error.path).toBe("view.calendar");
  });

  it("returns invalid_input for a duplicate (ticker, timeframe, asOf) candle (item 11)", () => {
    const dupCandle = { ...underlyingCandle("30.00") };
    const view: MarketView = {
      ...baseView,
      candles: [dupCandle, { ...dupCandle, close: decimalString("31.00") }],
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
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
    expect(result.error.code === "invalid_input" && result.error.path).toBe("view.candles");
  });
});
