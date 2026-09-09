import { describe, expect, it } from "vitest";
import { costModelSchema } from "./cost-model";

const costModel = {
  b3FeeRate: "0.0003",
  brokerage: { stockPerOrder: 0, optionPerContract: 50 },
  optionSlippageRate: "0.01",
  incomeTaxRate: "0.15",
  monthlyStockSalesExemption: 2000000,
};

describe("costModelSchema", () => {
  it("accepts the ADR-0004 default shape", () => {
    expect(costModelSchema.parse(costModel)).toEqual(costModel);
  });

  it("rejects negative brokerage and fractional centavos", () => {
    expect(
      costModelSchema.safeParse({
        ...costModel,
        brokerage: { stockPerOrder: -1, optionPerContract: 50 },
      }).success,
    ).toBe(false);
    expect(
      costModelSchema.safeParse({ ...costModel, monthlyStockSalesExemption: 20000.5 }).success,
    ).toBe(false);
  });

  it("rejects numeric rates and unknown keys", () => {
    expect(costModelSchema.safeParse({ ...costModel, incomeTaxRate: 0.15 }).success).toBe(false);
    expect(costModelSchema.safeParse({ ...costModel, lossCarryForward: true }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    const withoutSlippage = Object.fromEntries(
      Object.entries(costModel).filter(([key]) => key !== "optionSlippageRate"),
    );
    expect(costModelSchema.safeParse(withoutSlippage).success).toBe(false);
  });
});
