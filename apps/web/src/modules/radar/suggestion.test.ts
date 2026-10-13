import type { OperationPricing } from "@fetha/engine";
import { describe, expect, it } from "vitest";

import type { RadarLeg } from "./match";
import { suggestionClaim, suggestionFrom, suggestionHorizon } from "./suggestion";

const callLeg = (side: "buy" | "sell", ticker: string, expiry: string | null): RadarLeg =>
  ({ role: "call", side, ticker, strike: "31.00", expiry }) as RadarLeg;

const bullCallLegs = [
  callLeg("buy", "PETRK310", "2026-11-20"),
  callLeg("sell", "PETRK330", "2026-11-20"),
];

function pricingOf(overrides: Partial<Record<keyof OperationPricing, unknown>>): OperationPricing {
  return {
    underlying: "PETR4",
    legs: [
      { leg: { role: "call", side: "buy", ticker: "PETRK310", quantity: 100 }, price: "1.90" },
      { leg: { role: "call", side: "sell", ticker: "PETRK330", quantity: 100 }, price: "0.95" },
    ],
    netPremium: -9500,
    payoff: [
      { underlying: "28.00", pnl: -9500 },
      { underlying: "35.00", pnl: 10500 },
    ],
    breakEvens: ["31.95"],
    maxLoss: 9500,
    maxGain: 10500,
    ...overrides,
  } as unknown as OperationPricing;
}

describe("suggestionClaim", () => {
  it("claims a close above the break-even when the structure gains as the underlying rises", () => {
    expect(suggestionClaim(pricingOf({}))).toEqual({
      kind: "close_above",
      instrument: "PETR4",
      level: "31.95",
    });
  });

  it("claims a close below the break-even when the structure gains as the underlying falls", () => {
    const pricing = pricingOf({
      payoff: [
        { underlying: "28.00", pnl: 10500 },
        { underlying: "35.00", pnl: -9500 },
      ],
    });
    expect(suggestionClaim(pricing)).toMatchObject({ kind: "close_below", level: "31.95" });
  });

  it("reads the side from the highest underlying even when the payoff is unordered", () => {
    const pricing = pricingOf({
      payoff: [
        { underlying: "35.00", pnl: 10500 },
        { underlying: "28.00", pnl: -9500 },
        { underlying: "100.00", pnl: 10500 },
      ],
    });
    expect(suggestionClaim(pricing)).toMatchObject({ kind: "close_above" });
  });

  it("claims a positive P&L when there are two break-evens, none, or a flat top", () => {
    expect(suggestionClaim(pricingOf({ breakEvens: ["29.00", "33.00"] }))).toEqual({
      kind: "operation_pnl_positive",
    });
    expect(suggestionClaim(pricingOf({ breakEvens: [] }))).toEqual({
      kind: "operation_pnl_positive",
    });
    expect(
      suggestionClaim(
        pricingOf({
          payoff: [
            { underlying: "28.00", pnl: -9500 },
            { underlying: "35.00", pnl: 0 },
          ],
        }),
      ),
    ).toEqual({ kind: "operation_pnl_positive" });
  });
});

describe("suggestionHorizon", () => {
  it("is the options' shared expiry, ignoring a stock leg", () => {
    const stock = { role: "stock", side: "buy", ticker: "PETR4", strike: null, expiry: null };
    expect(suggestionHorizon([stock as RadarLeg, ...bullCallLegs])).toBe("2026-11-20");
  });

  it("is null when the options disagree or there is none", () => {
    expect(
      suggestionHorizon([
        callLeg("buy", "PETRK310", "2026-11-20"),
        callLeg("sell", "PETRL330", "2026-12-18"),
      ]),
    ).toBeNull();
    expect(suggestionHorizon([callLeg("buy", "PETR4", null)])).toBeNull();
  });
});

describe("suggestionFrom", () => {
  it("keeps the priced legs, the claim and the horizon", () => {
    const draft = suggestionFrom(pricingOf({}), bullCallLegs);
    expect(draft?.legs.map((leg) => leg.quantity)).toEqual([100, 100]);
    expect(draft?.horizon).toBe("2026-11-20");
    expect(draft?.claim.kind).toBe("close_above");
  });

  it("drops a match with an unbounded loss, an unpriced leg or no single expiry", () => {
    expect(suggestionFrom(pricingOf({ maxLoss: "unbounded" }), bullCallLegs)).toBeNull();
    const unpriced = pricingOf({});
    const [first, second] = unpriced.legs;
    expect(
      suggestionFrom(
        { ...unpriced, legs: [first, { ...second, price: null }] } as OperationPricing,
        bullCallLegs,
      ),
    ).toBeNull();
    expect(suggestionFrom(pricingOf({}), [callLeg("buy", "PETRK310", null)])).toBeNull();
  });
});
