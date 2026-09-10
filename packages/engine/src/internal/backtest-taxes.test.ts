import { describe, expect, it } from "vitest";
import type { CostModel } from "@fetha/contracts";
import { centavos, decimalString } from "../test/support";
import { computeMonthlyTax } from "./backtest-taxes";

const costModel: CostModel = {
  b3FeeRate: decimalString("0.0003"),
  brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
  optionSlippageRate: decimalString("0"),
  incomeTaxRate: decimalString("0.15"),
  monthlyStockSalesExemption: centavos(20_000_00),
};

describe("computeMonthlyTax", () => {
  it("exempts a month whose stock sales stay at or under the exemption, gains only", () => {
    const tax = computeMonthlyTax(
      "2024-01",
      centavos(20_000_00),
      centavos(1_000_00),
      centavos(0),
      costModel,
    );
    expect(tax).toEqual({
      month: "2024-01",
      stockSales: centavos(20_000_00),
      stockGain: centavos(1_000_00),
      optionGain: centavos(0),
      exemptGain: centavos(1_000_00),
      netGain: centavos(0),
      tax: centavos(0),
    });
  });

  it("drops the whole stock result (even a loss) in an exempt month", () => {
    const tax = computeMonthlyTax(
      "2024-01",
      centavos(5_000_00),
      centavos(-200_00),
      centavos(0),
      costModel,
    );
    expect(tax.exemptGain).toBe(centavos(0));
    expect(tax.netGain).toBe(centavos(0));
    expect(tax.tax).toBe(centavos(0));
  });

  it("taxes the whole stock gain at 15% when sales exceed the exemption", () => {
    const tax = computeMonthlyTax(
      "2024-02",
      centavos(21_000_00),
      centavos(10_000_00),
      centavos(0),
      costModel,
    );
    expect(tax.exemptGain).toBe(centavos(0));
    expect(tax.netGain).toBe(centavos(10_000_00));
    expect(tax.tax).toBe(centavos(1_500_00));
  });

  it("charges no tax on a non-exempt month with a net loss", () => {
    const tax = computeMonthlyTax(
      "2024-02",
      centavos(21_000_00),
      centavos(-10_000_00),
      centavos(0),
      costModel,
    );
    expect(tax.netGain).toBe(centavos(-10_000_00));
    expect(tax.tax).toBe(centavos(0));
  });

  it("taxes an option gain in full even in an exempt month, with no exemption of its own", () => {
    const tax = computeMonthlyTax(
      "2024-01",
      centavos(0),
      centavos(1_000_00),
      centavos(500_00),
      costModel,
    );
    expect(tax.exemptGain).toBe(centavos(1_000_00));
    expect(tax.netGain).toBe(centavos(500_00));
    expect(tax.tax).toBe(centavos(75_00));
  });

  it("nets a negative option result against a taxable stock gain, floored at zero, no loss carry-forward", () => {
    const tax = computeMonthlyTax(
      "2024-02",
      centavos(21_000_00),
      centavos(200_00),
      centavos(-500_00),
      costModel,
    );
    expect(tax.netGain).toBe(centavos(-300_00));
    expect(tax.tax).toBe(centavos(0));
  });
});
