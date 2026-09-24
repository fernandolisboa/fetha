import { z } from "zod";
import {
  centavosSchema,
  contemplatedLegSchema,
  exitRuleSchema,
  adjustmentRuleSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";
import { signalKinds, type IndicatorReading, type Proposal } from "@fetha/engine";

// The exact engine artifact a decision was taken on (brief item 2, table
// `decisions.inputs`): a snapshot, not a live reference, so a decision reads
// back the way it looked at the time even if the signal or operation it
// answers is later re-evaluated or re-priced. `indicators` and `proposal`
// carry engine types with no Zod schema of their own (packages/engine is
// zero-I/O and keeps no runtime validators, matching how signals-repository.ts
// stores the same fields) — `z.custom` keeps them typed without inventing a
// schema the engine does not own.
export const signalDecisionInputsSchema = z.strictObject({
  originKind: z.literal("signal"),
  ticker: tickerSchema,
  session: sessionDateSchema,
  kind: z.enum(signalKinds),
  indicators: z.array(z.custom<IndicatorReading>()),
  proposal: z.custom<Proposal>().nullable(),
  rule: z.union([exitRuleSchema, adjustmentRuleSchema]).nullable(),
});
export type SignalDecisionInputs = z.infer<typeof signalDecisionInputsSchema>;

export const operationDecisionInputsSchema = z.strictObject({
  originKind: z.literal("contemplated_operation"),
  underlying: tickerSchema,
  structureId: z.string().min(1),
  legs: z.array(contemplatedLegSchema),
  session: sessionDateSchema,
  netPremiumCentavos: centavosSchema,
  maxLossCentavos: centavosSchema.nullable(),
  maxGainCentavos: centavosSchema.nullable(),
  breachedLimits: z.array(z.string()),
});
export type OperationDecisionInputs = z.infer<typeof operationDecisionInputsSchema>;

export const decisionInputsSchema = z.discriminatedUnion("originKind", [
  signalDecisionInputsSchema,
  operationDecisionInputsSchema,
]);
export type DecisionInputs = z.infer<typeof decisionInputsSchema>;
