import { z } from "zod";
import { adjustmentRuleSchema } from "./adjustment-rule";
import { conditionSchema } from "./condition";
import { exitRuleSchema } from "./exit-rule";
import { expirySelectionSchema } from "./expiry-selection";
import { sizingRuleSchema } from "./sizing-rule";
import { strikeSelectionSchema } from "./strike-selection";
import { timeframeSchema } from "./timeframe";

export const strategyDefinitionSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    timeframe: timeframeSchema,
    entry: conditionSchema,
    structureId: z.string().min(1),
    strikes: z.array(strikeSelectionSchema).max(8),
    expiry: expirySelectionSchema.optional(),
    sizing: sizingRuleSchema,
    exit: z.array(exitRuleSchema).max(10),
    adjustments: z.array(adjustmentRuleSchema).max(5),
  })
  .refine((definition) => definition.strikes.length === 0 || definition.expiry !== undefined, {
    message: "expiry is required when the strategy selects strikes",
    path: ["expiry"],
  });
export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;
