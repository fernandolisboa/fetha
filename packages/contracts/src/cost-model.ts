import { z } from "zod";
import { centavosSchema, nonNegativeDecimalSchema, rightOpenUnitIntervalSchema } from "./scalars";

const nonNegativeCentavosSchema = centavosSchema.min(0);

export const costModelSchema = z.strictObject({
  b3FeeRate: nonNegativeDecimalSchema,
  brokerage: z.strictObject({
    stockPerOrder: nonNegativeCentavosSchema,
    optionPerContract: nonNegativeCentavosSchema,
  }),
  optionSlippageRate: nonNegativeDecimalSchema,
  incomeTaxRate: rightOpenUnitIntervalSchema,
  monthlyStockSalesExemption: nonNegativeCentavosSchema,
});
export type CostModel = z.infer<typeof costModelSchema>;
