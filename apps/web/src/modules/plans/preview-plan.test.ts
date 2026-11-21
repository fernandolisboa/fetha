import { describe, expect, it } from "vitest";
import {
  tickerSchema,
  type DecimalString,
  type SessionDate,
  type Structure,
} from "@fetha/contracts";
import type { MarketView, OptionSeries } from "@fetha/engine";

import { DEFAULT_RISK_PROFILE } from "@/modules/portfolio/client";

import type { PlanPreviewContext } from "./actions";
import type { PlanDiffLeg } from "./plan-diff";
import { previewPlan } from "./preview-plan";

const UNDERLYING = tickerSchema.parse("PETR4");
const AT = "2024-01-02T21:00:00.000Z";
const SESSION = "2024-01-02" as SessionDate;
const EXPIRY = "2024-01-21" as SessionDate;

function decimal(value: string): DecimalString {
  return value as DecimalString;
}

function dailyCalendar(fromDay: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const day = String(fromDay + index).padStart(2, "0");
    return {
      date: `2024-01-${day}`,
      open: `2024-01-${day}T13:00:00.000Z`,
      close: `2024-01-${day}T21:00:00.000Z`,
    };
  });
}

function callSeries(ticker: string, strike: string): OptionSeries {
  return {
    ticker: tickerSchema.parse(ticker),
    underlying: UNDERLYING,
    right: "call",
    strike: decimal(strike),
    expiry: EXPIRY,
    style: "european",
    asOf: AT,
  };
}

const CALL_BUTTERFLY: Structure = {
  id: "call-butterfly",
  name: "Borboleta com calls",
  expiry: "shared",
  legs: [
    { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
    { role: "call", side: "sell", ratio: 2, strikeRank: 2 },
    { role: "call", side: "buy", ratio: 1, strikeRank: 3 },
  ],
};

const MARKET_VIEW: MarketView = {
  calendar: dailyCalendar(2, 20),
  candles: [],
  corporateActions: [],
  optionSeries: [
    callSeries("PETR4K34", "34.00"),
    callSeries("PETR4K36", "36.00"),
    callSeries("PETR4K38", "38.00"),
  ],
  optionPrices: [
    {
      ticker: tickerSchema.parse("PETR4K34"),
      session: SESSION,
      asOf: AT,
      average: null,
      close: decimal("3.500000"),
      trades: 1,
      tradedQuantity: 100,
    },
    {
      ticker: tickerSchema.parse("PETR4K36"),
      session: SESSION,
      asOf: AT,
      average: null,
      close: decimal("2.000000"),
      trades: 1,
      tradedQuantity: 100,
    },
    {
      ticker: tickerSchema.parse("PETR4K38"),
      session: SESSION,
      asOf: AT,
      average: null,
      close: decimal("0.800000"),
      trades: 1,
      tradedQuantity: 100,
    },
  ],
  quotes: [{ ticker: UNDERLYING, asOf: AT, last: decimal("36.00"), bid: null, ask: null }],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

const CONTEXT: PlanPreviewContext = {
  marketView: MARKET_VIEW,
  at: AT,
  riskProfile: DEFAULT_RISK_PROFILE,
  openOperationCount: 0,
};

const LEGS: PlanDiffLeg[] = [
  { role: "call", side: "buy", ticker: tickerSchema.parse("PETR4K34") },
  { role: "call", side: "sell", ticker: tickerSchema.parse("PETR4K36") },
  { role: "call", side: "buy", ticker: tickerSchema.parse("PETR4K38") },
];

describe("previewPlan", () => {
  it("rebuilds a call-butterfly's legs from the structure's own ratio at two lots, not a flat lots * 100", async () => {
    const pricing = await previewPlan(CONTEXT, CALL_BUTTERFLY, UNDERLYING, LEGS, 2);
    expect(pricing).not.toBeNull();
    expect(pricing?.legs.map((valuation) => valuation.leg.quantity)).toEqual([200, 400, 200]);
  });

  it("prices at the limit-price rung, pinning the same maxLoss, maxGain and break-evens adjustPlanAction returns", async () => {
    const pricing = await previewPlan(CONTEXT, CALL_BUTTERFLY, UNDERLYING, LEGS, 2);
    expect(pricing).not.toBeNull();
    expect(pricing?.maxLoss).toBe(7660);
    expect(pricing?.maxGain).toBe(32340);
    expect(pricing?.breakEvens).toEqual(["34.38", "37.62"]);
  });

  it("returns null when the listed tickers do not line up with the structure's own template", async () => {
    const tooFewLegs = LEGS.slice(0, 2);
    const pricing = await previewPlan(CONTEXT, CALL_BUTTERFLY, UNDERLYING, tooFewLegs, 2);
    expect(pricing).toBeNull();
  });
});
