import { z } from "zod";

import { exitRuleSchema } from "./exit-rule";
import {
  centavosSchema,
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
} from "./scalars";
import { riskLimits, riskProfileSchema } from "./risk-profile";
import { costModelSchema } from "./cost-model";
import { sizingRuleSchema } from "./sizing-rule";
import { structureSchema } from "./structure";
import { strategyDefinitionSchema } from "./strategy-definition";

export const limitModeSchema = z.enum(["enforce", "warn"]);
export type LimitMode = z.infer<typeof limitModeSchema>;

// Mirrors packages/engine/src/api.ts BacktestCheckpoint. `state` is the
// engine's own opaque checkpoint payload (documented `unknown` in the
// engine's public type): only the engine may interpret it, so this schema
// validates the envelope the repository round-trips and leaves `state`
// unparsed rather than duplicating engine internals contracts must not
// depend on (ADR-0013).
export const backtestCheckpointSchema = z.strictObject({
  schema: z.literal(1),
  engineVersion: z.string().min(1),
  configDigest: z.string().min(1),
  cursor: sessionDateSchema,
  state: z.unknown(),
});
export type BacktestCheckpoint = z.infer<typeof backtestCheckpointSchema>;

const noteSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
});

const provenanceSchema = z.strictObject({
  engineVersion: z.string().min(1),
  pricingModel: z.string().min(1),
  truncated: z.array(
    z.strictObject({
      collection: z.string().min(1),
      ticker: tickerSchema.nullable(),
      dropped: z.int().min(0),
      reason: z.string().min(1),
    }),
  ),
  dataVersion: z.string().nullable(),
  datasetNotes: z.array(z.string()),
});

const operationLegSchema = z.strictObject({
  role: z.enum(["stock", "call", "put"]),
  side: z.enum(["buy", "sell"]),
  ticker: tickerSchema,
  quantity: quantitySchema,
  entryPrice: decimalStringSchema,
});

const operationSchema = z.strictObject({
  id: z.string().min(1),
  underlying: tickerSchema,
  legs: z.array(operationLegSchema).min(1),
  expiry: sessionDateSchema.nullable(),
  openedAt: sessionDateSchema,
  strategyVersionId: z.string().nullable(),
  rolledFrom: z.string().nullable(),
});

const fillSchema = z.strictObject({
  ticker: tickerSchema,
  side: z.enum(["buy", "sell"]),
  quantity: quantitySchema,
  price: decimalStringSchema,
  session: sessionDateSchema,
  at: instantSchema,
  costs: centavosSchema,
});

const simulatedFillSchema = fillSchema.extend({
  operationId: z.string().min(1),
  source: z.enum([
    "next_session_open",
    "next_session_average",
    "next_candle_open",
    "fair_value",
    "settlement",
  ]),
});

const missedEntrySchema = z.strictObject({
  ticker: tickerSchema,
  signalAt: instantSchema,
  sessionsTried: z.int().min(0),
  reason: z.enum([
    "no_trades",
    "limit_breach",
    "no_series_match",
    "degenerate_strikes",
    "unsizeable",
  ]),
});

const closeReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exit_rule"), rule: exitRuleSchema }),
  z.strictObject({ kind: z.literal("rolled"), toOperationId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("period_end") }),
]);

const legSettlementSchema = z.strictObject({
  leg: operationLegSchema,
  outcome: z.enum(["kept", "exercised", "assigned", "expired_worthless"]),
  intrinsicValue: decimalStringSchema.nullable(),
  fills: z.array(fillSchema),
});

const simulatedOperationSchema = z
  .intersection(
    operationSchema,
    z.strictObject({
      pnl: centavosSchema,
      maxLoss: z.union([centavosSchema, z.literal("unbounded")]),
      status: z.literal("closed"),
      closedAt: sessionDateSchema,
      closeReason: closeReasonSchema,
    }),
  )
  .or(
    z.intersection(
      operationSchema,
      z.strictObject({
        pnl: centavosSchema,
        maxLoss: z.union([centavosSchema, z.literal("unbounded")]),
        status: z.literal("expired"),
        closedAt: sessionDateSchema,
        settlement: z.array(legSettlementSchema),
        residualSettledBy: z.enum(["trade", "period_end"]).nullable(),
      }),
    ),
  );

const equityPointSchema = z.strictObject({
  session: sessionDateSchema,
  equity: centavosSchema,
  cash: centavosSchema,
  drawdown: decimalStringSchema,
});

const backtestMetricsSchema = z.strictObject({
  sessions: z.int().min(0),
  operations: z.int().min(0),
  totalReturn: decimalStringSchema,
  cagr: decimalStringSchema.nullable(),
  maxDrawdown: decimalStringSchema,
  sharpe: decimalStringSchema.nullable(),
  winRate: decimalStringSchema.nullable(),
  profitFactor: decimalStringSchema.nullable(),
  exposure: decimalStringSchema,
  fees: centavosSchema,
  taxes: centavosSchema,
  slippage: centavosSchema,
});

const walkForwardWindowSchema = z.strictObject({
  from: sessionDateSchema,
  to: sessionDateSchema,
  metrics: backtestMetricsSchema,
});

const monthlyTaxSchema = z.strictObject({
  month: z.string().min(1),
  stockSales: centavosSchema,
  stockGain: centavosSchema,
  optionGain: centavosSchema,
  exemptGain: centavosSchema,
  netGain: centavosSchema,
  tax: centavosSchema,
});

const riskLimitSchema = z.enum(riskLimits);

const sessionLimitBreachSchema = z.strictObject({
  limit: riskLimitSchema,
  value: decimalStringSchema,
  allowed: decimalStringSchema,
  session: sessionDateSchema,
  ticker: tickerSchema,
});

export const backtestConfigSchema = z.strictObject({
  strategy: z.strictObject({
    id: z.string().min(1),
    definition: strategyDefinitionSchema,
    structure: structureSchema,
  }),
  universe: z.array(tickerSchema).min(1),
  period: z.strictObject({ from: sessionDateSchema, to: sessionDateSchema }),
  initialCapital: centavosSchema,
  costModel: costModelSchema,
  riskProfile: riskProfileSchema,
  limits: limitModeSchema,
  sizing: sizingRuleSchema.nullable(),
  walkForward: z.strictObject({ windowSessions: z.int().positive() }).nullable(),
  seed: z.int(),
});
export type BacktestConfig = z.infer<typeof backtestConfigSchema>;

export const backtestRunSchema = z.strictObject({
  config: backtestConfigSchema,
  configDigest: z.string().min(1),
  operations: z.array(simulatedOperationSchema),
  fills: z.array(simulatedFillSchema),
  missedEntries: z.array(missedEntrySchema),
  limitBreaches: z.array(sessionLimitBreachSchema),
  equityCurve: z.array(equityPointSchema),
  metrics: backtestMetricsSchema,
  walkForward: z.array(walkForwardWindowSchema).nullable(),
  taxes: z.array(monthlyTaxSchema),
  notes: z.array(noteSchema),
  provenance: provenanceSchema,
});
export type BacktestRun = z.infer<typeof backtestRunSchema>;
