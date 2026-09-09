import { z } from "zod";
import { conditionSchema } from "./condition";
import { decimalStringSchema } from "./scalars";

export const exitRuleKinds = [
  "profit_target",
  "stop_loss",
  "days_before_expiry",
  "condition",
] as const;

export const exitRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("profit_target"), fractionOfPremium: decimalStringSchema }),
  z.strictObject({ kind: z.literal("stop_loss"), multipleOfMaxLoss: decimalStringSchema }),
  z.strictObject({ kind: z.literal("days_before_expiry"), businessDays: z.int().min(0) }),
  z.strictObject({ kind: z.literal("condition"), condition: conditionSchema }),
]);
export type ExitRule = z.infer<typeof exitRuleSchema>;
