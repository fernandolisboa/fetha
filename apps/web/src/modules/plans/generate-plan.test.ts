import { describe, expect, it } from "vitest";
import {
  tickerSchema,
  type Centavos,
  type DecimalString,
  type Quantity,
  type SessionDate,
} from "@fetha/contracts";
import type { LegValuation, OperationPricing } from "@fetha/engine";

import { recipeById } from "@/modules/strategies";

import { generatePlan, type GeneratePlanInput, type LotPricing } from "./generate-plan";

const UNDERLYING = tickerSchema.parse("PETR4");

function decimal(value: string): DecimalString {
  return value as DecimalString;
}

function quantity(value: number): Quantity {
  return value as Quantity;
}

function leg(
  overrides: Partial<LegValuation> & { role: "call" | "put"; side: "buy" | "sell"; ticker: string },
): LegValuation {
  return {
    leg: {
      role: overrides.role,
      side: overrides.side,
      ticker: tickerSchema.parse(overrides.ticker),
      quantity: quantity(100),
    },
    price: decimal("1.500000"),
    priceSource: "last",
    stale: null,
    fairValue: decimal("1.500000"),
    impliedVolatility: decimal("0.300000"),
    volatilitySource: "last_trade_implied",
    greeks: null,
    timeToExpiryYears: decimal("0.100000"),
    notes: [],
    ...overrides,
  };
}

function fixturePricing(
  lots: number,
  legs: LegValuation[],
  netPremiumPerLot: number,
  maxLossPerLot: number,
): OperationPricing {
  return {
    at: "2027-01-02T14:00:00.000Z",
    underlying: UNDERLYING,
    spot: decimal("36.000000"),
    riskFreeRate: decimal("0.100000"),
    dividendYield: decimal("0.000000"),
    legs: legs.map((valuation) => ({
      ...valuation,
      leg: { ...valuation.leg, quantity: quantity(100 * lots) },
    })),
    netPremium: (netPremiumPerLot * lots) as Centavos,
    greeks: {
      delta: decimal("0.300000"),
      gamma: decimal("0.010000"),
      theta: decimal("-0.020000"),
      vega: decimal("0.050000"),
      rho: decimal("0.010000"),
    },
    payoff: [],
    breakEvens: [decimal("36.700000")],
    maxLoss: (maxLossPerLot * lots) as Centavos,
    maxGain: (13000 * lots) as Centavos,
    limitBreaches: [],
    notes: [],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}

const BUY_LEG = leg({ role: "call", side: "buy", ticker: "PETR4K36", price: decimal("1.515000") });
const SELL_LEG = leg({
  role: "call",
  side: "sell",
  ticker: "PETR4K38",
  price: decimal("0.792000"),
});

// A bull call spread pays a debit (buys the lower strike, sells the higher one), so the net
// premium the engine reports is negative (round 1 review: the earlier fixture had this backwards).
function okLotPricing(lots: number): LotPricing {
  const probe = fixturePricing(lots, [BUY_LEG, SELL_LEG], -70, 10_000);
  return { probe, final: probe };
}

function baseInput(overrides: Partial<GeneratePlanInput> = {}): GeneratePlanInput {
  const recipe = recipeById("bull-call-spread-low-iv");
  if (!recipe) throw new Error("fixture recipe missing");
  return {
    recipe,
    structureId: "bull-call-spread",
    structureName: "Trava de alta com calls",
    underlying: UNDERLYING,
    view: "up",
    ivDisplay: "low",
    priceSessionDate: "2027-01-02",
    riskLimitCentavos: 35_000,
    pricingForLots: (lots) => Promise.resolve(okLotPricing(lots)),
    sessionsBeforeExpiry: (businessDays): SessionDate | null =>
      businessDays === 5 ? "2027-01-09" : null,
    ...overrides,
  };
}

describe("generatePlan", () => {
  it("sizes to the largest lot count that fits the risk limit and reports the final rung's limit prices", async () => {
    const result = await generatePlan(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.lots).toBe(3);
    expect(result.plan.legs).toEqual([
      {
        leg: { role: "call", side: "buy", ticker: "PETR4K36", quantity: 300 },
        limitPrice: "1.515000",
      },
      {
        leg: { role: "call", side: "sell", ticker: "PETR4K38", quantity: 300 },
        limitPrice: "0.792000",
      },
    ]);
    expect(result.plan.maxLossCentavos).toBe(30_000);
    expect(result.plan.netPremiumCentavos).toBe(-210);
    expect(result.plan.summary).toContain("alta");
    expect(result.plan.exitRules).toHaveLength(3);
    expect(result.plan.exitRules.at(-1)).toEqual({
      rule: { kind: "days_before_expiry", businessDays: 5 },
      session: "2027-01-09",
    });
    expect(result.plan.roll).toEqual({ applies: false, session: null });
  });

  it("reports the plan does not fit when even one lot exceeds the risk limit", async () => {
    const result = await generatePlan(baseInput({ riskLimitCentavos: 5_000 }));
    expect(result).toEqual({ ok: false, reason: "does_not_fit", oneLotMaxLossCentavos: 10_000 });
  });

  it("reports unpriceable when the engine never prices even one lot", async () => {
    const result = await generatePlan(baseInput({ pricingForLots: () => Promise.resolve(null) }));
    expect(result).toEqual({ ok: false, reason: "unpriceable" });
  });

  it("refuses the plan when a leg's price is stale", async () => {
    const stalePricing: LotPricing = {
      probe: fixturePricing(
        1,
        [BUY_LEG, { ...SELL_LEG, stale: { session: "2027-01-02" } }],
        -70,
        10_000,
      ),
      final: okLotPricing(1).final,
    };
    const result = await generatePlan(
      baseInput({ pricingForLots: () => Promise.resolve(stalePricing) }),
    );
    expect(result).toEqual({ ok: false, reason: "stale_prices" });
  });

  it("refuses the plan when a leg has no market price at all", async () => {
    const unpricedPricing: LotPricing = {
      probe: fixturePricing(1, [BUY_LEG, { ...SELL_LEG, price: null }], -70, 10_000),
      final: okLotPricing(1).final,
    };
    const result = await generatePlan(
      baseInput({ pricingForLots: () => Promise.resolve(unpricedPricing) }),
    );
    expect(result).toEqual({ ok: false, reason: "no_market_price" });
  });

  it("names the roll rule's date for a credit spread", async () => {
    const recipe = recipeById("bull-put-spread-high-iv");
    if (!recipe) throw new Error("fixture recipe missing");
    const result = await generatePlan(
      baseInput({ recipe, structureId: "bull-put-spread", view: "up", ivDisplay: "high" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.roll.applies).toBe(true);
  });

  it("summarizes a plan built from a suggestion without a stated view", async () => {
    const result = await generatePlan(baseInput({ view: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary).toContain("sugestão");
  });

  it("carries the final rung's limit breaches through to the plan", async () => {
    const breach = {
      limit: "maxLossPerOperation" as const,
      value: decimal("0.050000"),
      allowed: decimal("0.020000"),
    };
    const pricingWithBreach = (lots: number): LotPricing => {
      const base = okLotPricing(lots);
      return { probe: base.probe, final: { ...base.final, limitBreaches: [breach] } };
    };
    const result = await generatePlan(
      baseInput({ pricingForLots: (lots) => Promise.resolve(pricingWithBreach(lots)) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.limitBreaches).toEqual([breach]);
  });
});
