import { z } from "zod";
import { leftOpenUnitIntervalSchema } from "./scalars";

export const sizingRuleKinds = ["fixed_fractional", "fixed_risk"] as const;

export const sizingRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed_fractional"), fraction: leftOpenUnitIntervalSchema }),
  z.strictObject({ kind: z.literal("fixed_risk"), fraction: leftOpenUnitIntervalSchema }),
]);
export type SizingRule = z.infer<typeof sizingRuleSchema>;
