import { z } from "zod";
import { indicatorSpecSchema, type IndicatorSpec } from "./indicator-spec";
import { decimalStringSchema, type DecimalString } from "./scalars";

export const priceFields = ["open", "high", "low", "close", "tradedQuantity"] as const;
export const comparators = [">", ">=", "<", "<=", "==", "!="] as const;
export const conditionKinds = ["compare", "and", "or", "not"] as const;

export type Operand =
  | { kind: "indicator"; indicator: IndicatorSpec }
  | { kind: "price"; field: (typeof priceFields)[number] }
  | { kind: "constant"; value: DecimalString };

export const operandSchema: z.ZodType<Operand> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("indicator"), indicator: indicatorSpecSchema }),
  z.strictObject({ kind: z.literal("price"), field: z.enum(priceFields) }),
  z.strictObject({ kind: z.literal("constant"), value: decimalStringSchema }),
]);

// Written by hand because Zod cannot infer a recursive schema: z.lazy needs the type first.
export type Condition =
  | { kind: "compare"; left: Operand; comparator: (typeof comparators)[number]; right: Operand }
  | { kind: "and"; conditions: [Condition, ...Condition[]] }
  | { kind: "or"; conditions: [Condition, ...Condition[]] }
  | { kind: "not"; condition: Condition };

const rawConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("compare"),
      left: operandSchema,
      comparator: z.enum(comparators),
      right: operandSchema,
    }),
    z.strictObject({
      kind: z.literal("and"),
      conditions: z.tuple([rawConditionSchema], rawConditionSchema),
    }),
    z.strictObject({
      kind: z.literal("or"),
      conditions: z.tuple([rawConditionSchema], rawConditionSchema),
    }),
    z.strictObject({ kind: z.literal("not"), condition: rawConditionSchema }),
  ]),
);

// A strategy is data, never code (docs/adr/0008): an unbounded condition
// tree is still data, but a hostile or accidental deeply-nested one is a
// resource-exhaustion surface for every consumer that walks it (the
// editor, the engine, a future backtest). MAX_CONDITION_DEPTH caps it at
// the action edge.
export const MAX_CONDITION_DEPTH = 6;

export function conditionDepth(condition: Condition): number {
  if (condition.kind === "compare") {
    return 1;
  }
  if (condition.kind === "not") {
    return 1 + conditionDepth(condition.condition);
  }
  return 1 + Math.max(...condition.conditions.map(conditionDepth));
}

export const conditionSchema: z.ZodType<Condition> = rawConditionSchema.refine(
  (condition) => conditionDepth(condition) <= MAX_CONDITION_DEPTH,
  { message: `condition tree must be at most ${String(MAX_CONDITION_DEPTH)} levels deep` },
);
