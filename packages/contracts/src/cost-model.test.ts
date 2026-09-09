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

  it("accepts zero fees, zero slippage and a zero tax rate", () => {
    expect(
      costModelSchema.safeParse({
        ...costModel,
        b3FeeRate: "0",
        optionSlippageRate: "0",
        incomeTaxRate: "0",
      }).success,
    ).toBe(true);
  });

  it("rejects negative fee and slippage rates", () => {
    expect(costModelSchema.safeParse({ ...costModel, b3FeeRate: "-0.0003" }).success).toBe(false);
    expect(costModelSchema.safeParse({ ...costModel, optionSlippageRate: "-0.01" }).success).toBe(
      false,
    );
  });

  it("rejects an income tax rate of one or more, or negative", () => {
    for (const rate of ["1", "1.0", "15", "-0.15"]) {
      expect(costModelSchema.safeParse({ ...costModel, incomeTaxRate: rate }).success).toBe(false);
    }
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
