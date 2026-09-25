import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CostModel } from "@fetha/contracts";
import type { Candle, MarketView, Operation, ScoreInput, TradingSession } from "../api";
import { score } from "../internal/score";
import { instantMs } from "../internal/instant";
import { centavos, dailyCalendar, decimalString, quantity } from "../test/support";

const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const calendar: TradingSession[] = dailyCalendar(1, 10);
const horizonSession = calendar[4] as TradingSession;
const futureSession = calendar[9] as TradingSession;

const zeroCostModel: CostModel = {
  b3FeeRate: decimalString("0"),
  brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
  optionSlippageRate: decimalString("0"),
  incomeTaxRate: decimalString("0"),
  monthlyStockSalesExemption: centavos(0),
};

function stockCandle(session: TradingSession, close: string): Candle {
  return {
    ticker: "PETR4",
    timeframe: "D1",
    session: session.date,
    asOf: session.close,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
}

function operation(entryPrice: string, qty: number): Operation {
  return {
    id: "op-1",
    underlying: "PETR4",
    legs: [
      {
        role: "stock",
        side: "buy",
        ticker: "PETR4",
        quantity: quantity(qty),
        entryPrice: decimalString(entryPrice),
      },
    ],
    expiry: null,
    openedAt: "2024-01-01",
    strategyVersionId: null,
    rolledFrom: null,
  };
}

// Strips the one field the ADR says legitimately changes when a future row is appended
// (provenance.truncated, a growing count), matching I2's own convention.
const stripTruncated = (result: ReturnType<typeof score>): unknown => {
  if (!result.ok) return result;
  const { provenance, ...rest } = result.value;
  return {
    ok: true,
    value: {
      ...rest,
      provenance: {
        engineVersion: provenance.engineVersion,
        pricingModel: provenance.pricingModel,
        dataVersion: provenance.dataVersion,
        datasetNotes: provenance.datasetNotes,
      },
    },
  };
};

describe("I1 Future-blind — score", () => {
  it("appending a candle with asOf after the horizon session close never changes the score", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 500, max: 5_000 }),
        fc.integer({ min: 500, max: 5_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        fc.integer({ min: 500, max: 5_000 }),
        (entryCents, horizonCloseCents, qty, futureCloseCents) => {
          const entryPrice = (entryCents / 100).toFixed(2);
          const horizonClose = (horizonCloseCents / 100).toFixed(2);
          const futureClose = (futureCloseCents / 100).toFixed(2);

          const baseView: MarketView = {
            calendar,
            candles: [stockCandle(horizonSession, horizonClose)],
            corporateActions: [],
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [],
            dividendYields: [],
            impliedVolatilityIndex: [],
          };

          const input: ScoreInput = {
            view: baseView,
            subject: "hold",
            decidedAt: "2024-01-01T14:00:00.000Z",
            horizon: horizonSession.date,
            confidence: "0.5" as ScoreInput["confidence"],
            claim: null,
            operation: operation(entryPrice, qty),
            realizedFills: [],
            origin: { kind: "manual" },
            costModel: zeroCostModel,
          };

          const before = score(input, provenanceBase);

          const futureCandle = stockCandle(futureSession, futureClose);
          expect(instantMs(futureCandle.asOf)).toBeGreaterThan(instantMs(horizonSession.close));
          const after = score(
            { ...input, view: { ...baseView, candles: [...baseView.candles, futureCandle] } },
            provenanceBase,
          );

          expect(stripTruncated(after)).toEqual(stripTruncated(before));
        },
      ),
    );
  });
});
