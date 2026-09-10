import { describe, expect, it } from "vitest";
import type { MarketView, Operation, OptionSeries } from "../api";
import { dailyCalendar, decimalString, quantity } from "../test/support";
import { validateOperationCoherence } from "./operation-coherence";

const calendar = dailyCalendar(2, 20);
const at = "2024-01-10T21:00:00.000Z";

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

function callSeries(overrides: Partial<OptionSeries> = {}): OptionSeries {
  return {
    ticker: "PETR4C28",
    underlying: "PETR4",
    right: "call",
    strike: decimalString("28.00"),
    expiry: "2024-01-21",
    style: "european",
    asOf: at,
    ...overrides,
  };
}

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    underlying: "PETR4",
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: "PETR4C28",
        quantity: quantity(1),
        entryPrice: decimalString("2.50"),
      },
    ],
    expiry: "2024-01-21",
    openedAt: "2024-01-02",
    strategyVersionId: null,
    rolledFrom: null,
    ...overrides,
  };
}

describe("validateOperationCoherence", () => {
  it("accepts a coherent operation with a matching listed series", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries()] };
    expect(validateOperationCoherence(view, operation(), at, "op")).toBeNull();
  });

  it("rejects a stock-only operation carrying an expiry", () => {
    const op = operation({
      expiry: "2024-01-21",
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
    expect(validateOperationCoherence(baseView, op, at, "op")).toEqual({
      code: "invalid_input",
      path: "op.expiry",
      message: "a stock-only operation must not have an expiry",
    });
  });

  it("rejects an operation with option legs and no expiry", () => {
    const op = operation({ expiry: null });
    expect(validateOperationCoherence(baseView, op, at, "op")).toEqual({
      code: "invalid_input",
      path: "op.expiry",
      message: "an operation with option legs must have an expiry",
    });
  });

  it("rejects a stock leg whose ticker does not match the operation's underlying", () => {
    const op = operation({
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(1),
          entryPrice: decimalString("10.00"),
        },
      ],
      expiry: null,
    });
    expect(validateOperationCoherence(baseView, op, at, "op")).toEqual({
      code: "invalid_input",
      path: "op.legs[0].ticker",
      message: "a stock leg's ticker must match the operation's underlying",
    });
  });

  it("rejects an option leg whose listed expiry does not match the operation's expiry", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries({ expiry: "2024-02-01" })],
    };
    expect(validateOperationCoherence(view, operation(), at, "op")).toEqual({
      code: "invalid_input",
      path: "op.legs[0]",
      message: "an option leg's listed expiry does not match the operation's expiry",
    });
  });

  it("rejects an option leg whose listed underlying does not match the operation's underlying (item 7)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries({ underlying: "VALE3" })],
    };
    expect(validateOperationCoherence(view, operation(), at, "op")).toEqual({
      code: "invalid_input",
      path: "op.legs[0]",
      message: "an option leg's listed underlying does not match the operation's underlying",
    });
  });

  it("rejects an option leg whose role does not match its listed series' right (item 7)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [callSeries({ right: "put" })],
    };
    expect(validateOperationCoherence(view, operation(), at, "op")).toEqual({
      code: "invalid_input",
      path: "op.legs[0]",
      message: "an option leg's role does not match its listed series' right",
    });
  });

  it("rejects an operation opened after the instant it is valued at (item 7)", () => {
    const view: MarketView = { ...baseView, optionSeries: [callSeries()] };
    const op = operation({ openedAt: "2024-01-15" });
    expect(validateOperationCoherence(view, op, at, "op")).toEqual({
      code: "invalid_input",
      path: "op.openedAt",
      message: "an operation cannot be opened after the instant it is valued at",
    });
  });

  it("leaves the openedAt check unenforced when the calendar does not cover at", () => {
    const view: MarketView = {
      ...baseView,
      calendar: [],
      optionSeries: [callSeries()],
    };
    const op = operation({ openedAt: "2024-01-15" });
    expect(validateOperationCoherence(view, op, at, "op")).toBeNull();
  });

  it("does not reject a leg whose series is not visible in the view (left to missing_instrument)", () => {
    expect(validateOperationCoherence(baseView, operation(), at, "op")).toBeNull();
  });
});
