import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type {
  Candle,
  CorporateActionFactor,
  MarketView,
  Operation,
  OptionSeries,
  PositionValuation,
  Quote,
  TradingSession,
} from "../api";
import { markToMarket } from "../internal/mark-to-market";
import { instantMs } from "../internal/instant";
import { priceOperation } from "../internal/price-operation";
import { proposeSettlement } from "../internal/propose-settlement";
import { centavos, decimalString, quantity, signedQuantity } from "../test/support";
import { candlePriceArbitrary } from "./arbitraries";

const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const at = "2024-01-02T21:00:00.000Z";
const calendar: TradingSession[] = [
  { date: "2024-01-01", open: "2024-01-01T13:00:00.000Z", close: "2024-01-01T21:00:00.000Z" },
  { date: "2024-01-02", open: "2024-01-02T13:00:00.000Z", close: "2024-01-02T21:00:00.000Z" },
];

const emptyView: MarketView = {
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

function stockOperation(id: string, entryPrice: string, underlying = "PETR4"): Operation {
  return {
    id,
    underlying,
    legs: [
      {
        role: "stock",
        side: "buy",
        ticker: underlying,
        quantity: quantity(100),
        entryPrice: decimalString(entryPrice),
      },
    ],
    expiry: null,
    openedAt: "2024-01-01",
    strategyVersionId: null,
    rolledFrom: null,
  };
}

const asOfPlusMs = (asOf: string, ms: number): string =>
  new Date(instantMs(asOf) + ms).toISOString();

describe("markToMarket equals priceOperation on freshly opened legs", () => {
  it("marks a freshly opened stock operation to a zero unrealized P&L and the same pricing priceOperation gives", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, (price) => {
        const view: MarketView = {
          ...emptyView,
          quotes: [{ ticker: "PETR4", asOf: at, last: price, bid: null, ask: null }],
        };
        const op = stockOperation("op-1", price);
        const mtmResult = markToMarket(
          { view, at, positions: [], operations: [op], cash: centavos(0) },
          provenanceBase,
        );
        const priceResult = priceOperation(
          {
            view,
            at,
            legs: [{ role: "stock", side: "buy", ticker: "PETR4", quantity: quantity(100) }],
          },
          provenanceBase,
        );
        expect(mtmResult.ok).toBe(true);
        expect(priceResult.ok).toBe(true);
        if (!mtmResult.ok || !priceResult.ok) return;
        expect(mtmResult.value.operations[0]?.unrealizedPnl).toBe(0);
        expect(mtmResult.value.operations[0]?.pricing).toEqual(priceResult.value);
      }),
    );
  });
});

describe("markToMarket determinism", () => {
  it("identical inputs yield deep-equal artifacts", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, (price) => {
        const view: MarketView = {
          ...emptyView,
          quotes: [{ ticker: "PETR4", asOf: at, last: price, bid: null, ask: null }],
        };
        const input = {
          view,
          at,
          positions: [],
          operations: [stockOperation("op-1", "10.00")],
          cash: centavos(0),
        };
        expect(markToMarket(input, provenanceBase)).toEqual(markToMarket(input, provenanceBase));
      }),
    );
  });
});

describe("markToMarket order-invariance (I3)", () => {
  it("permuting operations and positions yields the same valuations once re-sorted by id/ticker", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, candlePriceArbitrary, (petrPrice, valePrice) => {
        const view: MarketView = {
          ...emptyView,
          quotes: [
            { ticker: "PETR4", asOf: at, last: petrPrice, bid: null, ask: null },
            { ticker: "VALE3", asOf: at, last: valePrice, bid: null, ask: null },
          ],
        };
        const opA = stockOperation("op-a", "10.00", "PETR4");
        const opB = stockOperation("op-b", "20.00", "VALE3");
        const forward = markToMarket(
          { view, at, positions: [], operations: [opA, opB], cash: centavos(0) },
          provenanceBase,
        );
        const reversed = markToMarket(
          { view, at, positions: [], operations: [opB, opA], cash: centavos(0) },
          provenanceBase,
        );
        expect(forward.ok).toBe(true);
        expect(reversed.ok).toBe(true);
        if (!forward.ok || !reversed.ok) return;
        const byId = (a: { operation: Operation }, b: { operation: Operation }): number =>
          a.operation.id < b.operation.id ? -1 : 1;
        expect([...forward.value.operations].sort(byId)).toEqual(
          [...reversed.value.operations].sort(byId),
        );
        expect(forward.value.totals).toEqual(reversed.value.totals);
      }),
    );
  });
});

describe("I1 Future-blind — markToMarket", () => {
  it("appending a quote after the mark instant never changes the valuation", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, candlePriceArbitrary, (price, futurePrice) => {
        const view = (extra: Quote[]): MarketView => ({
          ...emptyView,
          quotes: [{ ticker: "PETR4", asOf: at, last: price, bid: null, ask: null }, ...extra],
        });
        const op = stockOperation("op-1", "10.00");
        const input = {
          view: view([]),
          at,
          positions: [],
          operations: [op],
          cash: centavos(0),
        };
        const futureQuote: Quote = {
          ticker: "PETR4",
          asOf: asOfPlusMs(at, 1),
          last: futurePrice,
          bid: null,
          ask: null,
        };
        const extended = { ...input, view: view([futureQuote]) };
        expect(markToMarket(extended, provenanceBase)).toEqual(markToMarket(input, provenanceBase));
      }),
    );
  });

  it("appending a corporate-action factor after the mark instant never changes a stale option mark's valuation (round 4 item 1)", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, (price) => {
        const staleSession = "2024-01-01";
        const series: OptionSeries = {
          ticker: "PETR4C28",
          underlying: "PETR4",
          right: "call",
          strike: decimalString("28.00"),
          expiry: "2024-12-31",
          style: "european",
          asOf: at,
        };
        const view = (extra: CorporateActionFactor[]): MarketView => ({
          ...emptyView,
          calendar: [
            ...calendar,
            {
              date: "2024-12-31",
              open: "2024-12-31T13:00:00.000Z",
              close: "2024-12-31T21:00:00.000Z",
            },
          ],
          quotes: [{ ticker: "PETR4", asOf: at, last: price, bid: null, ask: null }],
          optionSeries: [series],
          optionPrices: [
            {
              ticker: "PETR4C28",
              session: staleSession,
              asOf: at,
              average: null,
              close: decimalString("2.50"),
              trades: 1,
              tradedQuantity: 1,
            },
          ],
          corporateActions: extra,
        });
        const op: Operation = {
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
          expiry: "2024-12-31",
          openedAt: "2024-01-01",
          strategyVersionId: null,
          rolledFrom: null,
        };
        const input = {
          view: view([]),
          at,
          positions: [],
          operations: [op],
          cash: centavos(0),
        };
        const futureFactor: CorporateActionFactor = {
          ticker: "PETR4",
          exDate: "2024-01-02",
          asOf: asOfPlusMs(at, 1),
          factor: decimalString("0.5"),
        };
        const extended = { ...input, view: view([futureFactor]) };
        expect(markToMarket(extended, provenanceBase)).toEqual(markToMarket(input, provenanceBase));
      }),
    );
  });

  it("appending a market price after the mark instant never changes a standalone position's valuation", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, candlePriceArbitrary, (price, futurePrice) => {
        const view = (extra: Quote[]): MarketView => ({
          ...emptyView,
          quotes: [{ ticker: "PETR4", asOf: at, last: price, bid: null, ask: null }, ...extra],
        });
        const position = {
          ticker: "PETR4",
          quantity: signedQuantity(100),
          averageCost: decimalString("10.00"),
        };
        const input = {
          view: view([]),
          at,
          positions: [position],
          operations: [],
          cash: centavos(0),
        };
        const futureQuote: Quote = {
          ticker: "PETR4",
          asOf: asOfPlusMs(at, 1),
          last: futurePrice,
          bid: null,
          ask: null,
        };
        const extended = { ...input, view: view([futureQuote]) };
        const base = markToMarket(input, provenanceBase);
        const withFuture = markToMarket(extended, provenanceBase);
        expect(base.ok).toBe(true);
        expect(withFuture.ok).toBe(true);
        if (!base.ok || !withFuture.ok) return;
        const strip = (p: PositionValuation): unknown => p;
        expect(withFuture.value.positions.map(strip)).toEqual(base.value.positions.map(strip));
      }),
    );
  });
});

describe("I1 Future-blind — markToMarket at an operation's own expiry session (round 3 item 1)", () => {
  it("an expiry-session candle with asOf > at never changes the valuation before the session's close", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, candlePriceArbitrary, (spot, futureClose) => {
        const expiry = "2024-01-02";
        const expirySessionOpen = "2024-01-02T13:00:00.000Z";
        const expirySessionMidday = "2024-01-02T15:00:00.000Z";
        const expirySessionClose = "2024-01-02T21:00:00.000Z";
        const series: OptionSeries = {
          ticker: "PETR4C28",
          underlying: "PETR4",
          right: "call",
          strike: decimalString("28.00"),
          expiry,
          style: "european",
          asOf: expirySessionOpen,
        };
        const op: Operation = {
          id: "op-covered",
          underlying: "PETR4",
          legs: [
            {
              role: "call",
              side: "sell",
              ticker: "PETR4C28",
              quantity: quantity(1),
              entryPrice: decimalString("2.00"),
            },
          ],
          expiry,
          openedAt: "2024-01-01",
          strategyVersionId: null,
          rolledFrom: null,
        };
        const view = (extra: Candle[]): MarketView => ({
          ...emptyView,
          quotes: [{ ticker: "PETR4", asOf: expirySessionOpen, last: spot, bid: null, ask: null }],
          optionSeries: [series],
          candles: extra,
        });
        const futureCandle: Candle = {
          ticker: "PETR4",
          timeframe: "D1",
          session: expiry,
          asOf: expirySessionClose,
          open: futureClose,
          high: futureClose,
          low: futureClose,
          close: futureClose,
          tradedQuantity: 1,
        };
        const input = {
          view: view([]),
          at: expirySessionMidday,
          positions: [],
          operations: [op],
          cash: centavos(0),
        };
        const extended = { ...input, view: view([futureCandle]) };
        expect(markToMarket(extended, provenanceBase)).toEqual(markToMarket(input, provenanceBase));
      }),
    );
  });
});

describe("I1 Future-blind — proposeSettlement", () => {
  it("appending a later candle revision for the expiry session never changes the settlement instant already at the session close", () => {
    fc.assert(
      fc.property(candlePriceArbitrary, candlePriceArbitrary, (close, futureClose) => {
        const expiry = "2024-01-02";
        const expiryClose = "2024-01-02T21:00:00.000Z";
        const baseCandle: Candle = {
          ticker: "PETR4",
          timeframe: "D1",
          session: expiry,
          asOf: expiryClose,
          open: close,
          high: close,
          low: close,
          close,
          tradedQuantity: 1,
        };
        const series: OptionSeries = {
          ticker: "PETR4C28",
          underlying: "PETR4",
          right: "call",
          strike: decimalString("1.00"),
          expiry,
          style: "european",
          asOf: expiryClose,
        };
        // A stock-only operation has no expiry to settle (`validateOperationCoherence`
        // rejects one that has, before `proposeSettlement` ever reaches `latestVisible`),
        // which made this property vacuous — both sides collapsed to the same coherence
        // error regardless of the candle revision (round 1 item 5). An option leg with a
        // visible series exercises the real in-the-money branch instead.
        const view = (extra: Candle[]): MarketView => ({
          ...emptyView,
          candles: [baseCandle, ...extra],
          optionSeries: [series],
        });
        const op: Operation = {
          id: "op-1",
          underlying: "PETR4",
          legs: [
            {
              role: "call",
              side: "buy",
              ticker: "PETR4C28",
              quantity: quantity(1),
              entryPrice: decimalString("1.00"),
            },
          ],
          expiry,
          openedAt: "2024-01-01",
          strategyVersionId: null,
          rolledFrom: null,
        };
        const futureCandle: Candle = {
          ...baseCandle,
          asOf: asOfPlusMs(expiryClose, 1),
          close: futureClose,
        };
        const baseResult = proposeSettlement({ view: view([]), operation: op }, provenanceBase);
        const extendedResult = proposeSettlement(
          { view: view([futureCandle]), operation: op },
          provenanceBase,
        );
        expect(baseResult.ok).toBe(true);
        expect(baseResult).toEqual(extendedResult);
      }),
    );
  });
});
