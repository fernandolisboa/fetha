import { centavosSchema, decimalStringSchema, tickerSchema } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { storedIdeaPricingSchema } from "./research-schemas";

const decimal = (value: string) => decimalStringSchema.parse(value);

const basePricing = {
  netPremium: centavosSchema.parse(-12000),
  maxLoss: centavosSchema.parse(12000),
  maxGain: "unbounded" as const,
  breakEvens: [decimal("39.70")],
  spot: decimal("39.00"),
  payoff: [{ underlying: decimal("39.00"), pnl: centavosSchema.parse(-12000) }],
};

// ADR-0082: `probabilityOfProfit` is absent on an idea stored before 0.21.0, and `null` on a
// stock-only operation or when the model has nothing to compute it from; the schema accepts all
// three shapes a stored `pricing` jsonb can carry.
describe("storedIdeaPricingSchema", () => {
  it("accepts a pricing with no probabilityOfProfit key (stored before ADR-0082)", () => {
    const result = storedIdeaPricingSchema.safeParse(basePricing);
    expect(result.success).toBe(true);
    expect(result.data?.probabilityOfProfit).toBeUndefined();
  });

  it("accepts a pricing with probabilityOfProfit null", () => {
    const result = storedIdeaPricingSchema.safeParse({ ...basePricing, probabilityOfProfit: null });
    expect(result.success).toBe(true);
    expect(result.data?.probabilityOfProfit).toBeNull();
  });

  it("accepts a pricing with the full probabilityOfProfit shape", () => {
    const result = storedIdeaPricingSchema.safeParse({
      ...basePricing,
      probabilityOfProfit: {
        probability: decimal("0.4085"),
        volatility: decimal("0.300000"),
        volatilityFrom: [tickerSchema.parse("PETRK385")],
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.probabilityOfProfit).toEqual({
      probability: "0.4085",
      volatility: "0.300000",
      volatilityFrom: ["PETRK385"],
    });
  });
});
