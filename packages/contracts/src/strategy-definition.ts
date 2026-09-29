import { z } from "zod";
import { adjustmentRuleSchema } from "./adjustment-rule";
import { conditionIndicators, conditionSchema } from "./condition";
import { exitRuleSchema } from "./exit-rule";
import { expirySelectionSchema } from "./expiry-selection";
import { isWithinIndicatorBounds, type IndicatorSpec } from "./indicator-spec";
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

function definitionIndicators(definition: StrategyDefinition): IndicatorSpec[] {
  return [
    ...conditionIndicators(definition.entry),
    ...definition.exit.flatMap((rule) =>
      rule.kind === "condition" ? conditionIndicators(rule.condition) : [],
    ),
  ];
}

// docs/adr/0049: the write edge (actions, editor) parses with this schema;
// stored versions keep parsing with `strategyDefinitionSchema`, so a bound
// added later never makes an existing strategy unreadable.
export const strategyDefinitionInputSchema = strategyDefinitionSchema.refine(
  (definition) => definitionIndicators(definition).every(isWithinIndicatorBounds),
  { message: "indicator parameters exceed their bounds", path: ["entry"] },
);
