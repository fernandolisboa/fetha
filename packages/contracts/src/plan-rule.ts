import { z } from "zod";
import { exitRuleSchema } from "./exit-rule";
import { sessionDateSchema } from "./scalars";

// An operation plan's exit rule (docs/adr/0079), with the one session the rule resolves to: a
// `days_before_expiry` rule names a concrete date, a `profit_target` or `stop_loss` carries none
// of its own, since it fires against price, not the calendar.
export const resolvedExitRuleSchema = z.strictObject({
  rule: exitRuleSchema,
  session: sessionDateSchema.nullable(),
});
export type ResolvedExitRule = z.infer<typeof resolvedExitRuleSchema>;

// A roll rule (ADR-0079): states the rule and its date, never executes it (ticket #379; rolling
// itself is #382/#383).
export const rollRuleSchema = z.strictObject({
  applies: z.boolean(),
  session: sessionDateSchema.nullable(),
});
export type RollRule = z.infer<typeof rollRuleSchema>;

// The rules half of a saved operation plan: the contemplated operation itself already carries
// the structure, legs and pricing (`contemplated_operations`), this is what a plan adds on top
// (docs/adr/0079).
export const planRulesSchema = z.strictObject({
  recipeId: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  exitRules: z.array(resolvedExitRuleSchema).min(1),
  roll: rollRuleSchema,
});
export type PlanRules = z.infer<typeof planRulesSchema>;
