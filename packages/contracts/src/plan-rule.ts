import { z } from "zod";
import { contemplatedLegSchema } from "./contemplated-leg";
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

// Fetha's own generated legs and lot count (docs/adr/0079 addendum, ticket #380), kept
// alongside the saved plan even when the user never touched a handle: the contemplated
// operation's own `legs`/quantity already carry whatever the user last saw on the screen
// (Fetha's plan, unedited, when they changed nothing), so this is what lets a later scoring
// pass ("Fetha's plan vs. the user's edits", still #380/#381's own scope to compute) diff the
// two without a second table — the saved operation's legs are the edited (or unedited) side,
// this is the original side. Absent for a plan saved before ticket #380 shipped: those rows
// never wrote this field, and `planRulesSchema.parse` must still read them back.
export const planOriginalSchema = z.strictObject({
  legs: z.array(contemplatedLegSchema).min(1),
  // A count of ADR-0067's standard, 100-share lot — the same unit the plan screen's lot
  // stepper counts in, not a share quantity (`quantitySchema` already types each leg's own
  // `quantity` in `legs` above).
  lots: z.int().positive(),
});
export type PlanOriginal = z.infer<typeof planOriginalSchema>;

// The rules half of a saved operation plan: the contemplated operation itself already carries
// the structure, legs and pricing (`contemplated_operations`), this is what a plan adds on top
// (docs/adr/0079).
export const planRulesSchema = z.strictObject({
  recipeId: z.string().min(1).max(200),
  summary: z.string().min(1).max(2000),
  exitRules: z.array(resolvedExitRuleSchema).min(1),
  roll: rollRuleSchema,
  original: planOriginalSchema.optional(),
});
export type PlanRules = z.infer<typeof planRulesSchema>;
