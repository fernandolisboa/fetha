import Decimal from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RiskProfile } from "@fetha/contracts";
import type { Candle, MarketView, Operation } from "../api";
import { markToMarket } from "../internal/mark-to-market";
import { centavos, dailyCalendar, decimalString, quantity } from "../test/support";

const at = "2024-01-02T21:00:00.000Z";
const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const riskProfile: RiskProfile = {
  declaredCapital: centavos(100_000_00),
  limits: {
    maxLossPerOperation: decimalString("0.05"),
    maxExposurePerOperation: decimalString("0.1"),
    maxOpenOperations: 5,
    maxPremiumBought: decimalString("0.05"),
  },
};

function asPrice(value: Decimal): string {
  return value.toFixed(Math.max(2, value.decimalPlaces()));
}

function candle(session: string, close: string): Candle {
  return {
    ticker: "PETR4",
    timeframe: "D1",
    session,
    asOf: `${session}T21:00:00.000Z`,
    open: decimalString(close),
    high: decimalString(close),
    low: decimalString(close),
    close: decimalString(close),
    tradedQuantity: 1000,
  };
}

function mark(candles: Candle[], factor: Decimal, held: number, entryPrice: Decimal) {
  const view: MarketView = {
    calendar: dailyCalendar(2, 20),
    candles,
    corporateActions: [
      {
        ticker: "PETR4",
        exDate: "2024-01-02",
        asOf: "2024-01-02T13:00:00.000Z",
        factor: decimalString(factor.toString()),
      },
    ],
    optionSeries: [],
    optionPrices: [],
    quotes: [],
    macro: [],
    dividendYields: [],
    impliedVolatilityIndex: [],
  };
  const operation: Operation = {
    id: "op-1",
    underlying: "PETR4",
    legs: [
      {
        role: "stock",
        side: "buy",
        ticker: "PETR4",
        quantity: quantity(held),
        entryPrice: decimalString(asPrice(entryPrice)),
      },
    ],
    expiry: null,
    openedAt: "2024-01-01",
    strategyVersionId: null,
    rolledFrom: null,
  };
  const result = markToMarket(
    { view, at, positions: [], operations: [operation], cash: centavos(0), riskProfile },
    provenanceBase,
  );
  if (!result.ok) throw new Error(`test setup: unexpected engine error ${result.error.code}`);
  const valuation = result.value.operations[0];
  if (!valuation) throw new Error("test setup: one operation in, one valuation out");
  const { spot, netPremium, payoff, breakEvens, maxLoss, maxGain, limitBreaches } =
    valuation.pricing;
  return {
    spot,
    netPremium,
    payoff,
    breakEvens,
    maxLoss,
    maxGain,
    limitBreaches,
    unrealizedPnl: valuation.unrealizedPnl,
  };
}

describe("Stale price split-scale invariance (#285)", () => {
  it("prices a position whose last trade predates an ex-date exactly as if that trade had been printed on the post-split scale on the mark session", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 100, max: 100_000 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (lastTradeCents, entryCents, factorHundredths, held) => {
          const lastTrade = new Decimal(lastTradeCents).div(100);
          const entryPrice = new Decimal(entryCents).div(100);
          const factor = new Decimal(factorHundredths).div(100);

          const carriedForward = mark(
            [candle("2024-01-01", asPrice(lastTrade))],
            factor,
            held,
            entryPrice,
          );
          const printedPostSplit = mark(
            [candle("2024-01-02", asPrice(lastTrade.mul(factor)))],
            factor,
            held,
            entryPrice,
          );

          expect(carriedForward).toEqual(printedPostSplit);
        },
      ),
    );
  });
});
