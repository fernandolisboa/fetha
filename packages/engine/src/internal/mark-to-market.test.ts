import { describe, expect, it } from "vitest";
import type { RiskProfile } from "@fetha/contracts";
import type {
  CorporateActionFactor,
  MarketView,
  Operation,
  OptionSeries,
  Position,
  TradingSession,
} from "../api";
import { centavos, decimalString, quantity, signedQuantity } from "../test/support";
import { markToMarket } from "./mark-to-market";

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

function stockOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    underlying: "PETR4",
    legs: [
      {
        role: "stock",
        side: "buy",
        ticker: "PETR4",
        quantity: quantity(100),
        entryPrice: decimalString("10.00"),
      },
    ],
    expiry: null,
    openedAt: "2024-01-01",
    strategyVersionId: null,
    rolledFrom: null,
    ...overrides,
  };
}

describe("markToMarket", () => {
  it("marks a stock-only operation's unrealized P&L against its entry price", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
    };
    const result = markToMarket(
      { view, at, positions: [], operations: [stockOperation()], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(200_00));
    expect(result.value.operations[0]?.pricing.spot).toBe(decimalString("12.00"));
  });

  it("flags a stale mark on an option leg with the session of its last trade, fair value alongside", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null }],
      optionSeries: [callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-01",
          asOf: at,
          average: null,
          close: decimalString("3.00"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const op = stockOperation({
      id: "op-call",
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
    });
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const leg = result.value.operations[0]?.pricing.legs[0];
    expect(leg?.stale).toEqual({ session: "2024-01-01" });
    expect(leg?.fairValue).not.toBeNull();
    expect(leg?.notes).toContainEqual({
      code: "stale_price",
      message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
    });
  });

  it("aggregates greeks across operations, signed by side and quantity", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null }],
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
    const longCall = stockOperation({
      id: "op-long",
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
    });
    const shortCall = stockOperation({
      id: "op-short",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
      expiry: "2024-01-21",
    });
    const result = markToMarket(
      { view, at, positions: [], operations: [longCall, shortCall], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.greeks.delta).toBe(decimalString("0.000000"));
  });

  it("reports a breach on the portfolio's limitBreaches when an operation exceeds a risk-profile limit", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null }],
    };
    const tightProfile: RiskProfile = {
      declaredCapital: centavos(1_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.01"),
        maxExposurePerOperation: decimalString("0.01"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("0.01"),
      },
    };
    const result = markToMarket(
      {
        view,
        at,
        positions: [],
        operations: [stockOperation()],
        cash: centavos(0),
        riskProfile: tightProfile,
      },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.limitBreaches).not.toEqual([]);
    expect(result.value.limitBreaches).toEqual(result.value.operations[0]?.pricing.limitBreaches);
  });

  it("notes no_risk_profile when none is supplied", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
    };
    const result = markToMarket(
      { view, at, positions: [], operations: [stockOperation()], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes).toContainEqual({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
  });

  it("scales a stock leg's unrealized P&L by the split factor between openedAt and the mark session", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("16.00"), bid: null, ask: null }],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.5"),
        } satisfies CorporateActionFactor,
      ],
    };
    const op = stockOperation({ openedAt: "2024-01-01" });
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 old shares are worth what 200 post-split shares represent: 16.00 / 0.5 = 32.00 per
    // old share, true pnl = 100 * (32.00 - 10.00) = R$2200.00.
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(2_200_00));
  });

  it("prices standalone positions, aggregating equity and unrealized P&L with cash", () => {
    const view: MarketView = {
      ...baseView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-02",
          asOf: at,
          open: decimalString("12.00"),
          high: decimalString("12.00"),
          low: decimalString("12.00"),
          close: decimalString("12.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(100),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view, at, positions: [position], operations: [], cash: centavos(1_000_00) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positions[0]?.value).toBe(centavos(1_200_00));
    expect(result.value.positions[0]?.unrealizedPnl).toBe(centavos(200_00));
    expect(result.value.totals.equity).toBe(centavos(1_000_00 + 1_200_00));
    expect(result.value.totals.unrealizedPnl).toBe(centavos(200_00));
  });

  it("flags a short position with a negative value and gains when the price falls", () => {
    const view: MarketView = {
      ...baseView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-02",
          asOf: at,
          open: decimalString("8.00"),
          high: decimalString("8.00"),
          low: decimalString("8.00"),
          close: decimalString("8.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(-100),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view, at, positions: [position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positions[0]?.value).toBe(centavos(-800_00));
    expect(result.value.positions[0]?.unrealizedPnl).toBe(centavos(200_00));
  });

  it("reports no_market_price and a null value/unrealizedPnl for an unpriced position", () => {
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(100),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view: baseView, at, positions: [position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positions[0]?.value).toBeNull();
    expect(result.value.positions[0]?.unrealizedPnl).toBeNull();
    expect(result.value.notes).toContainEqual({
      code: "no_market_price",
      message: "at least one position has no visible market price",
    });
  });

  it("returns invalid_input for a duplicate operation id", () => {
    const op = stockOperation();
    const result = markToMarket(
      { view: baseView, at, positions: [], operations: [op, op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operations",
      message: "duplicate operation id op-1",
    });
  });

  it("returns invalid_input for a duplicate position ticker", () => {
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(100),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view: baseView, at, positions: [position, position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "positions",
      message: "duplicate position for PETR4",
    });
  });

  it("returns invalid_input when a stock-only operation carries an expiry", () => {
    const op = stockOperation({ expiry: "2024-01-21" });
    const result = markToMarket(
      { view: baseView, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operations[0].expiry",
      message: "a stock-only operation must not have an expiry",
    });
  });

  it("returns invalid_input when an operation with option legs has no expiry", () => {
    const op = stockOperation({
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.50"),
        },
      ],
      expiry: null,
    });
    const view: MarketView = { ...baseView, optionSeries: [callSeries("PETR4C28", "28.00")] };
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operations[0].expiry",
      message: "an operation with option legs must have an expiry",
    });
  });

  it("returns invalid_input when the operation's underlying spot is not positive", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("0.00"), bid: null, ask: null }],
    };
    const result = markToMarket(
      { view, at, positions: [], operations: [stockOperation()], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operations[].spot",
      message: "the underlying's spot must be positive",
    });
  });

  it("contributes zero unrealized P&L for a leg with neither a price nor a fair value", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
      optionSeries: [callSeries("PETR4C28", "28.00")],
    };
    const op = stockOperation({
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
    });
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(0));
  });

  it("flags a stale mark on a standalone position with the session of its last trade", () => {
    const view: MarketView = {
      ...baseView,
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-01",
          asOf: at,
          open: decimalString("12.00"),
          high: decimalString("12.00"),
          low: decimalString("12.00"),
          close: decimalString("12.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(100),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view, at, positions: [position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.positions[0]?.stale).toEqual({ session: "2024-01-01" });
    expect(result.value.positions[0]?.notes).toContainEqual({
      code: "stale_price",
      message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
    });
  });

  it("returns missing_instrument when the operation's underlying has no visible spot", () => {
    const result = markToMarket(
      { view: baseView, at, positions: [], operations: [stockOperation()], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ code: "missing_instrument", ticker: "PETR4" });
  });
});
