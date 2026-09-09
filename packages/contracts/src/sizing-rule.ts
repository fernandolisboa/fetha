import { z } from "zod";
import { decimalStringSchema } from "./scalars";

export const sizingRuleKinds = ["fixed_fractional", "fixed_risk"] as const;

export const sizingRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed_fractional"), fraction: decimalStringSchema }),
  z.strictObject({ kind: z.literal("fixed_risk"), fraction: decimalStringSchema }),
]);
export type SizingRule = z.infer<typeof sizingRuleSchema>;
