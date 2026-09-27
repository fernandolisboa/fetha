import { z } from "zod";
import { centavosSchema, nonNegativeDecimalSchema, rightOpenUnitIntervalSchema } from "./scalars";

const nonNegativeCentavosSchema = centavosSchema.min(0);

export const costModelSchema = z.strictObject({
  b3FeeRate: nonNegativeDecimalSchema,
  // Absent on cost models stored before ADR-0040, which charged b3FeeRate on option fills too.
  b3OptionFeeRate: nonNegativeDecimalSchema.optional(),
  brokerage: z.strictObject({
    stockPerOrder: nonNegativeCentavosSchema,
    optionPerOrder: nonNegativeCentavosSchema,
  }),
  optionSlippageRate: nonNegativeDecimalSchema,
  incomeTaxRate: rightOpenUnitIntervalSchema,
  monthlyStockSalesExemption: nonNegativeCentavosSchema,
});
export type CostModel = z.infer<typeof costModelSchema>;
