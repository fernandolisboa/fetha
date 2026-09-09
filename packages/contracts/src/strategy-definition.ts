import { z } from "zod";
import { adjustmentRuleSchema } from "./adjustment-rule";
import { conditionSchema } from "./condition";
import { exitRuleSchema } from "./exit-rule";
import { expirySelectionSchema } from "./expiry-selection";
import { sizingRuleSchema } from "./sizing-rule";
import { strikeSelectionSchema } from "./strike-selection";
import { timeframeSchema } from "./timeframe";

export const strategyDefinitionSchema = z.strictObject({
  name: z.string().min(1),
  timeframe: timeframeSchema,
  entry: conditionSchema,
  structureId: z.string().min(1),
  strikes: z.array(strikeSelectionSchema),
  expiry: expirySelectionSchema.optional(),
  sizing: sizingRuleSchema,
  exit: z.array(exitRuleSchema),
  adjustments: z.array(adjustmentRuleSchema),
});
export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;
