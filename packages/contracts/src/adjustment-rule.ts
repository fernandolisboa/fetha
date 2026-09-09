import { z } from "zod";
import { exitRuleSchema } from "./exit-rule";
import { expirySelectionSchema } from "./expiry-selection";
import { strikeSelectionSchema } from "./strike-selection";

export const adjustmentRuleKinds = ["roll"] as const;

export const adjustmentRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("roll"),
    when: exitRuleSchema,
    expiry: expirySelectionSchema,
    strikes: z.array(strikeSelectionSchema),
  }),
]);
export type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;
