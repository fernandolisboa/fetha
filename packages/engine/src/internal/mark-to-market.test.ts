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
import { centavos, dailyCalendar, decimalString, quantity, signedQuantity } from "../test/support";
import { markToMarket } from "./mark-to-market";

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

  it("aggregates a hand-computed, non-zero totals.greeks.delta from standalone positions, not stock-only operations (round 3 item 3)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null },
        { ticker: "VALE3", asOf: at, last: decimalString("60.00"), bid: null, ask: null },
      ],
    };
    const longPetr = stockOperation({
      id: "op-long-petr",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
        },
      ],
    });
    const shortVale = stockOperation({
      id: "op-short-vale",
      underlying: "VALE3",
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "VALE3",
          quantity: quantity(40),
          entryPrice: decimalString("55.00"),
        },
      ],
    });
    const positions: Position[] = [
      { ticker: "PETR4", quantity: signedQuantity(100), averageCost: decimalString("25.00") },
      { ticker: "VALE3", quantity: signedQuantity(-40), averageCost: decimalString("55.00") },
    ];
    const result = markToMarket(
      { view, at, positions, operations: [longPetr, shortVale], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A stock-only operation's own leg is excluded from totals.greeks (round 3 item 3): a
    // priced position's own signed quantity is delta 1 per share, a long 100-share position
    // contributes +100, a short 40-share position contributes -40: 100 - 40 = 60. The two
    // operations above are the same shares' attribution view and contribute nothing further.
    expect(result.value.totals.greeks).toEqual({
      delta: decimalString("60.000000"),
      gamma: decimalString("0.000000"),
      theta: decimalString("0.000000"),
      vega: decimalString("0.000000"),
      rho: decimalString("0.000000"),
    });
  });

  it("does not double count a ticker held both as a standalone position and inside an operation (item 6)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
    };
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(50),
      averageCost: decimalString("10.00"),
    };
    const op = stockOperation({
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
    const result = markToMarket(
      { view, at, positions: [position], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ADR-0013 "totals are cash plus position values only": the operation's own
    // unrealizedPnl (100 shares * R$2.00 = R$200.00) must not add to the portfolio total on
    // top of the standalone position's own (50 shares * R$2.00 = R$100.00).
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(200_00));
    expect(result.value.positions[0]?.unrealizedPnl).toBe(centavos(100_00));
    expect(result.value.totals.unrealizedPnl).toBe(centavos(100_00));
  });

  it("does not double count a covered call's own stock leg delta against the same shares tracked as a position (round 3 item 3)", () => {
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
          close: decimalString("2.30"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(100),
      averageCost: decimalString("25.00"),
    };
    const op = stockOperation({
      id: "op-covered",
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
      expiry: "2024-01-21",
    });
    const result = markToMarket(
      { view, at, positions: [position], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const callLeg = result.value.operations[0]?.pricing.legs[1];
    expect(callLeg?.leg.role).toBe("call");
    expect(callLeg?.greeks?.delta).toBe(decimalString("0.800505"));
    // The position's own 100 shares already give delta 100; the covered call's own stock
    // leg tracks the same shares (item 6) and must not add its own +100 again, only the
    // short call's own delta contribution: 100 + (-1 * 1 * 0.800505) = 99.199495.
    expect(result.value.totals.greeks.delta).toBe(decimalString("99.199495"));
  });

  it("computes openOperationCount as operations.length - 1 for every operation in the same call (item 6)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
    };
    const profile: RiskProfile = {
      declaredCapital: centavos(1_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1.00"),
        maxExposurePerOperation: decimalString("1.00"),
        maxOpenOperations: 2,
        maxPremiumBought: decimalString("1.00"),
      },
    };
    const operations = [stockOperation({ id: "op-1" }), stockOperation({ id: "op-2" })];
    const result = markToMarket(
      { view, at, positions: [], operations, cash: centavos(0), riskProfile: profile },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two operations at a limit of 2 must not breach: each operation's own
    // openOperationCount is operations.length - 1 = 1, so 1 + 1 = 2, at the limit, not over.
    expect(result.value.limitBreaches.filter((b) => b.limit === "maxOpenOperations")).toEqual([]);
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

  it("reports maxOpenOperations once on the portfolio even when every operation breaches it (item 4)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
    };
    const profile: RiskProfile = {
      declaredCapital: centavos(1_000_000_00),
      limits: {
        maxLossPerOperation: decimalString("1.00"),
        maxExposurePerOperation: decimalString("1.00"),
        maxOpenOperations: 2,
        maxPremiumBought: decimalString("1.00"),
      },
    };
    const operations = [
      stockOperation({ id: "op-1" }),
      stockOperation({ id: "op-2" }),
      stockOperation({ id: "op-3" }),
    ];
    const result = markToMarket(
      { view, at, positions: [], operations, cash: centavos(0), riskProfile: profile },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const openOperationsBreaches = result.value.limitBreaches.filter(
      (b) => b.limit === "maxOpenOperations",
    );
    expect(openOperationsBreaches).toHaveLength(1);
    expect(openOperationsBreaches[0]).toEqual({
      limit: "maxOpenOperations",
      value: decimalString("3.000000"),
      allowed: decimalString("2.000000"),
    });
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

  it("rebases a covered call's stock leg quantity across a 2:1 split (ADR-0014 Q51)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("10.00"), bid: null, ask: null }],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.5"),
        } satisfies CorporateActionFactor,
      ],
      optionSeries: [callSeries("PETR4C28", "28.00")],
      optionPrices: [
        {
          ticker: "PETR4C28",
          session: "2024-01-02",
          asOf: at,
          average: null,
          close: decimalString("0.50"),
          trades: 1,
          tradedQuantity: 1,
        },
      ],
    };
    const op = stockOperation({
      openedAt: "2024-01-01",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("20.00"),
        },
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
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
    const stockLeg = result.value.operations[0]?.pricing.legs[0];
    // Pre-split 100 shares are 200 post-split shares; the legInput fed to pricing must carry
    // the post-split count, or exposure/greeks/maxLoss read off by the split factor.
    expect(stockLeg?.leg.quantity).toBe(quantity(200));
    expect(stockLeg?.greeks?.delta).toBe(decimalString("1.000000"));
    const optionLeg = result.value.operations[0]?.pricing.legs[1];
    expect(optionLeg?.leg.quantity).toBe(quantity(1));
    // The stock entry price is rebased to the post-split scale too (20.00 * 0.5 = 10.00), so
    // marking at the post-split spot of 10.00 shows no phantom gain on the stock leg from the
    // split itself; the short call (untouched by the stock's split factor) contributes
    // (2.00 - 0.50) * 1 unit = R$150 of unrealized gain.
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(150));
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
      message: "no visible market price for position(s): PETR4",
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
      path: "operations[0].spot",
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

  it("names the operation on the portfolio's no_market_price note (item 9)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
      optionSeries: [callSeries("PETR4C28", "28.00")],
    };
    const op = stockOperation({
      id: "op-unpriced-leg",
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
    expect(result.value.notes).toContainEqual({
      code: "no_market_price",
      message: "operation op-unpriced-leg has at least one leg with no visible market price",
    });
  });

  it("adds a priced stock position's signed quantity to totals.greeks.delta (item 9)", () => {
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
      quantity: signedQuantity(-30),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view, at, positions: [position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.greeks.delta).toBe(decimalString("-30.000000"));
  });

  it("does not add an unpriced position's quantity to totals.greeks.delta", () => {
    const position: Position = {
      ticker: "PETR4",
      quantity: signedQuantity(30),
      averageCost: decimalString("10.00"),
    };
    const result = markToMarket(
      { view: baseView, at, positions: [position], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totals.greeks.delta).toBe(decimalString("0.000000"));
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

  it("marks a covered call's expired short leg at intrinsic with settlement_pending instead of aborting (item 3)", () => {
    const markAt = "2024-01-10T21:00:00.000Z";
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: markAt, last: decimalString("30.00"), bid: null, ask: null },
      ],
      optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2024-01-05" }],
      candles: [
        {
          ticker: "PETR4",
          timeframe: "D1",
          session: "2024-01-05",
          asOf: "2024-01-05T21:00:00.000Z",
          open: decimalString("30.00"),
          high: decimalString("30.00"),
          low: decimalString("30.00"),
          close: decimalString("30.00"),
          tradedQuantity: 1000,
        },
      ],
    };
    const op = stockOperation({
      id: "op-covered",
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
      expiry: "2024-01-05",
    });
    const result = markToMarket(
      { view, at: markAt, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const optionLeg = result.value.operations[0]?.pricing.legs[1];
    expect(optionLeg?.price).toBeNull();
    expect(optionLeg?.fairValue).toBe(decimalString("2.00"));
    expect(optionLeg?.greeks).toBeNull();
    expect(optionLeg?.notes).toContainEqual({
      code: "settlement_pending",
      message:
        "the operation's listed expiry has passed; valued at intrinsic pending settlement (ADR-0014 Q41)",
    });
    // The stock leg is unaffected and keeps marking normally through `at`.
    const stockLeg = result.value.operations[0]?.pricing.legs[0];
    expect(stockLeg?.price).toBe(decimalString("30.00"));
  });

  it("prices a short call normally, never at intrinsic, before its own expiry session's close (round 3 item 1)", () => {
    const expirySessionOpen = "2024-01-05T13:00:00.000Z";
    const expirySessionClose = "2024-01-05T21:00:00.000Z";
    const sweep: Record<string, boolean> = {
      "2024-01-05T13:00:00.000Z": false,
      "2024-01-05T15:00:00.000Z": false,
      "2024-01-05T21:00:00.000Z": true,
      "2024-01-05T21:00:00.001Z": true,
      "2024-01-06T21:00:00.000Z": true,
    };
    for (const [markAt, expectSettlementPending] of Object.entries(sweep)) {
      const view: MarketView = {
        ...baseView,
        quotes: [
          {
            ticker: "PETR4",
            asOf: expirySessionOpen,
            last: decimalString("30.00"),
            bid: null,
            ask: null,
          },
        ],
        optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2024-01-05" }],
        optionPrices: [
          {
            ticker: "PETR4C28",
            session: "2024-01-04",
            asOf: expirySessionOpen,
            average: null,
            close: decimalString("2.30"),
            trades: 1,
            tradedQuantity: 1,
          },
        ],
        candles: [
          {
            ticker: "PETR4",
            timeframe: "D1",
            session: "2024-01-05",
            asOf: expirySessionClose,
            open: decimalString("30.00"),
            high: decimalString("30.00"),
            low: decimalString("30.00"),
            close: decimalString("30.00"),
            tradedQuantity: 1000,
          },
        ],
      };
      const op = stockOperation({
        id: "op-covered",
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
        expiry: "2024-01-05",
      });
      const result = markToMarket(
        { view, at: markAt, positions: [], operations: [op], cash: centavos(0) },
        provenanceBase,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const optionLeg = result.value.operations[0]?.pricing.legs[1];
      const hasSettlementPending =
        optionLeg?.notes.some((n) => n.code === "settlement_pending") ?? false;
      expect(hasSettlementPending).toBe(expectSettlementPending);
      if (expectSettlementPending) {
        expect(optionLeg?.greeks).toBeNull();
      } else {
        expect(optionLeg?.greeks).not.toBeNull();
      }
    }
  });

  it("values an expired operation's option legs at zero unrealizedPnl with a note, instead of aborting, when its expiry session has no underlying candle (round 3 item 5)", () => {
    const markAt = "2024-01-10T21:00:00.000Z";
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: markAt, last: decimalString("30.00"), bid: null, ask: null },
      ],
      optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2024-01-05" }],
    };
    const op = stockOperation({
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-01-05",
    });
    const result = markToMarket(
      { view, at: markAt, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations[0]?.pricing.legs).toEqual([]);
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(0));
    expect(result.value.operations[0]?.pricing.notes).toContainEqual({
      code: "no_market_price",
      message:
        "the operation's listed expiry has passed and no expiry-session candle is visible; at least one leg is excluded from pricing.legs and contributes zero unrealizedPnl pending that data",
    });
  });

  it("keeps valuing every other operation in the same call when one operation's expiry candle is missing (round 3 item 5)", () => {
    const markAt = "2024-01-10T21:00:00.000Z";
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: markAt, last: decimalString("30.00"), bid: null, ask: null },
      ],
      optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2024-01-05" }],
    };
    const broken = stockOperation({
      id: "op-broken",
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-01-05",
    });
    const healthy = stockOperation({ id: "op-healthy" });
    const result = markToMarket(
      { view, at: markAt, positions: [], operations: [broken, healthy], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations[1]?.pricing.spot).toBe(decimalString("30.00"));
    expect(result.value.operations[1]?.unrealizedPnl).toBe(centavos(2_000_00));
  });

  it("indexes an invalid-spot error by the operation's position in the operations array", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [
        { ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null },
        { ticker: "VALE3", asOf: at, last: decimalString("0.00"), bid: null, ask: null },
      ],
    };
    const opA = stockOperation({ id: "op-a" });
    const opB = stockOperation({
      id: "op-b",
      underlying: "VALE3",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "VALE3",
          quantity: quantity(100),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    const result = markToMarket(
      { view, at, positions: [], operations: [opA, opB], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "operations[1].spot",
      message: "the underlying's spot must be positive",
    });
  });

  it("returns insufficient_data when the calendar does not cover the mark instant (item 8)", () => {
    const result = markToMarket(
      {
        view: { ...baseView, calendar: [] },
        at,
        positions: [],
        operations: [stockOperation()],
        cash: centavos(0),
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("returns invalid_input for a non-positive corporate-action factor visible to a leg (item 8)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.00"),
        } satisfies CorporateActionFactor,
      ],
    };
    const result = markToMarket(
      {
        view,
        at,
        positions: [],
        operations: [stockOperation({ openedAt: "2024-01-01" })],
        cash: centavos(0),
      },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "corporateActions[].factor",
      message: "a corporate-action factor must be positive",
    });
  });

  it("values a stock leg dissolved below one effective unit by a grouping instead of throwing (round 3 item 2)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("120.00"), bid: null, ask: null }],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("10"),
        } satisfies CorporateActionFactor,
      ],
    };
    const op = stockOperation({
      openedAt: "2024-01-01",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(5),
          entryPrice: decimalString("10.00"),
        },
      ],
    });
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5 pre-grouping shares over a 10:1 grouping dissolve to 0.5 effective shares: no Quantity
    // can represent that, so the leg is excluded from pricing.legs and the aggregate greeks and
    // payoff, but its residual value is still folded into unrealizedPnl on the unrounded 0.5
    // (effective entry 10.00 * 10 = 100.00; mark 120.00; (120 - 100) * 0.5 = R$10.00).
    expect(result.value.operations[0]?.pricing.legs).toEqual([]);
    expect(result.value.operations[0]?.unrealizedPnl).toBe(centavos(1000));
    expect(result.value.operations[0]?.pricing.notes).toContainEqual({
      code: "less_than_one_effective_unit",
      message:
        "a corporate-action factor leaves at least one leg with less than one effective unit; excluded from pricing.legs and the aggregate greeks/payoff, its residual value is folded into unrealizedPnl",
    });
  });

  it("returns invalid_input, never throwing, when a near-zero corporate-action factor overflows a safe integer effective quantity (round 3 item 2)", () => {
    const view: MarketView = {
      ...baseView,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("12.00"), bid: null, ask: null }],
      corporateActions: [
        {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: "2024-01-02T13:00:00.000Z",
          factor: decimalString("0.000000000000001"),
        } satisfies CorporateActionFactor,
      ],
    };
    const op = stockOperation({ openedAt: "2024-01-01" });
    const result = markToMarket(
      { view, at, positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns insufficient_data when an expired operation's expiry session is missing from the calendar", () => {
    const shortCalendar: TradingSession[] = [
      { date: "2024-01-02", open: "2024-01-02T13:00:00.000Z", close: "2024-01-02T21:00:00.000Z" },
      { date: "2024-01-10", open: "2024-01-10T13:00:00.000Z", close: "2024-01-10T21:00:00.000Z" },
    ];
    const view: MarketView = {
      ...baseView,
      calendar: shortCalendar,
      quotes: [{ ticker: "PETR4", asOf: at, last: decimalString("30.00"), bid: null, ask: null }],
      optionSeries: [{ ...callSeries("PETR4C28", "28.00"), expiry: "2024-01-05" }],
    };
    const op = stockOperation({
      legs: [
        {
          role: "call",
          side: "sell",
          ticker: "PETR4C28",
          quantity: quantity(1),
          entryPrice: decimalString("2.00"),
        },
      ],
      expiry: "2024-01-05",
    });
    const result = markToMarket(
      { view, at: "2024-01-10T21:00:00.000Z", positions: [], operations: [op], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("insufficient_data");
  });

  it("returns invalid_input for a duplicate calendar date (item 11)", () => {
    const view: MarketView = {
      ...baseView,
      calendar: [...calendar, calendar[0] as TradingSession],
    };
    const result = markToMarket(
      { view, at, positions: [], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "view.calendar",
      message: "duplicate calendar date 2024-01-02",
    });
  });

  it("returns invalid_input for a duplicate (ticker, timeframe, asOf) candle (item 11)", () => {
    const candle = {
      ticker: "PETR4",
      timeframe: "D1" as const,
      session: "2024-01-02",
      asOf: at,
      open: decimalString("10.00"),
      high: decimalString("10.00"),
      low: decimalString("10.00"),
      close: decimalString("10.00"),
      tradedQuantity: 100,
    };
    const view: MarketView = {
      ...baseView,
      candles: [candle, { ...candle, close: decimalString("11.00") }],
    };
    const result = markToMarket(
      { view, at, positions: [], operations: [], cash: centavos(0) },
      provenanceBase,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalid_input",
      path: "view.candles",
      message: `duplicate candle for PETR4|D1|${at}`,
    });
  });
});
