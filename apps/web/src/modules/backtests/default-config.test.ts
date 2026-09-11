import { describe, expect, it } from "vitest";

import { DEFAULT_COST_MODEL } from "./default-config";

describe("DEFAULT_COST_MODEL", () => {
  // ADR-0004 / Lei 11.033/2004 art. 3 II: the simplified monthly stock-sales
  // exemption is R$ 20.000,00 (2.000.000 centavos), not R$ 2.000.000,00 (the
  // fixture value the engine's own tests use to *disable* the exemption).
  // At R$ 2.000.000,00 every realistic month is exempt and metrics.taxes is
  // always zero.
  it("uses the real R$ 20.000,00 monthly stock-sales exemption, not the fixture value that disables it", () => {
    expect(DEFAULT_COST_MODEL.monthlyStockSalesExemption).toBe(20_000_00);
  });

  it("is well below a realistic month's stock sales, so a month over the exemption is actually taxed", () => {
    const realisticMonthlySales = 100_000_00;
    expect(DEFAULT_COST_MODEL.monthlyStockSalesExemption).toBeLessThan(realisticMonthlySales);
  });
});
