import { z } from "zod";
import { centavosSchema, decimalStringSchema } from "./scalars";

const nonNegativeCentavosSchema = centavosSchema.min(0);

export const costModelSchema = z.strictObject({
  b3FeeRate: decimalStringSchema,
  brokerage: z.strictObject({
    stockPerOrder: nonNegativeCentavosSchema,
    optionPerContract: nonNegativeCentavosSchema,
  }),
  optionSlippageRate: decimalStringSchema,
  incomeTaxRate: decimalStringSchema,
  monthlyStockSalesExemption: nonNegativeCentavosSchema,
});
export type CostModel = z.infer<typeof costModelSchema>;
