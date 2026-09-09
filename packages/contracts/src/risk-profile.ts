import { z } from "zod";
import { centavosSchema, leftOpenUnitIntervalSchema } from "./scalars";

export const riskLimits = [
  "maxLossPerOperation",
  "maxExposurePerOperation",
  "maxOpenOperations",
  "maxPremiumBought",
] as const;

export const riskProfileSchema = z.strictObject({
  declaredCapital: centavosSchema.positive(),
  limits: z.strictObject({
    maxLossPerOperation: leftOpenUnitIntervalSchema,
    maxExposurePerOperation: leftOpenUnitIntervalSchema,
    maxOpenOperations: z.int().min(1),
    maxPremiumBought: leftOpenUnitIntervalSchema,
  }),
});
export type RiskProfile = z.infer<typeof riskProfileSchema>;
