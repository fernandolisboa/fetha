import { z } from "zod";
import { centavosSchema, decimalStringSchema } from "./scalars";

export const riskLimits = [
  "maxLossPerOperation",
  "maxExposurePerOperation",
  "maxOpenOperations",
  "maxPremiumBought",
] as const;

export const riskProfileSchema = z.strictObject({
  declaredCapital: centavosSchema.positive(),
  limits: z.strictObject({
    maxLossPerOperation: decimalStringSchema,
    maxExposurePerOperation: decimalStringSchema,
    maxOpenOperations: z.int().min(1),
    maxPremiumBought: decimalStringSchema,
  }),
});
export type RiskProfile = z.infer<typeof riskProfileSchema>;
