import Decimal from "decimal.js";
import type { Centavos, CostModel } from "@fetha/contracts";
import type { MonthlyTax } from "../api";
import { parseDecimal } from "./decimal";
import { toCentavos } from "./scalars";

export function computeMonthlyTax(
  month: string,
  stockSales: Centavos,
  stockGain: Centavos,
  optionGain: Centavos,
  costModel: CostModel,
): MonthlyTax {
  const exempt = stockSales <= costModel.monthlyStockSalesExemption;
  const exemptGain = exempt ? toCentavos(Math.max(stockGain, 0)) : toCentavos(0);
  const taxableStockGain = exempt ? 0 : stockGain;
  const netGain = toCentavos(taxableStockGain + optionGain);
  const tax = toCentavos(
    Math.max(netGain, 0) === 0
      ? 0
      : new Decimal(Math.max(netGain, 0))
          .mul(parseDecimal(costModel.incomeTaxRate))
          .round()
          .toNumber(),
  );
  return {
    month,
    stockSales,
    stockGain,
    optionGain,
    exemptGain,
    netGain,
    tax,
  };
}
