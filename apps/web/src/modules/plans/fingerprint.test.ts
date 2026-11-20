import { describe, expect, it } from "vitest";

import { planFingerprint } from "./fingerprint";
import type { GeneratedPlan } from "./generate-plan";

function plan(overrides: Partial<GeneratedPlan> = {}): GeneratedPlan {
  return {
    structureId: "bull-call-spread",
    underlying: "PETR4",
    summary: "x",
    lots: 3,
    legs: [
      {
        leg: { role: "call", side: "buy", ticker: "PETR4K36", quantity: 300 as never },
        limitPrice: "1.515000" as never,
      },
      {
        leg: { role: "call", side: "sell", ticker: "PETR4K38", quantity: 300 as never },
        limitPrice: "0.792000" as never,
      },
    ],
    netPremiumCentavos: -210 as never,
    maxLossCentavos: 30_000 as never,
    maxGainCentavos: 13_000 as never,
    breakEvens: [],
    limitBreaches: [],
    spot: "36.000000" as never,
    payoff: [],
    payoffNow: null,
    exitRules: [],
    roll: { applies: false, session: null },
    ...overrides,
  };
}

describe("planFingerprint", () => {
  it("is stable for the same structure, lot count and legs", () => {
    expect(planFingerprint(plan())).toBe(planFingerprint(plan()));
  });

  it("changes when the lot count differs", () => {
    expect(planFingerprint(plan())).not.toBe(planFingerprint(plan({ lots: 2 })));
  });

  it("changes when a leg's ticker differs", () => {
    const other = plan({
      legs: [
        {
          leg: { role: "call", side: "buy", ticker: "PETR4K37", quantity: 300 as never },
          limitPrice: "1.515000" as never,
        },
        {
          leg: { role: "call", side: "sell", ticker: "PETR4K38", quantity: 300 as never },
          limitPrice: "0.792000" as never,
        },
      ],
    });
    expect(planFingerprint(plan())).not.toBe(planFingerprint(other));
  });

  it("ignores the limit price (its own tolerance already covers that)", () => {
    const other = plan({
      legs: [
        {
          leg: { role: "call", side: "buy", ticker: "PETR4K36", quantity: 300 as never },
          limitPrice: "1.600000" as never,
        },
        {
          leg: { role: "call", side: "sell", ticker: "PETR4K38", quantity: 300 as never },
          limitPrice: "0.792000" as never,
        },
      ],
    });
    expect(planFingerprint(plan())).toBe(planFingerprint(other));
  });
});
