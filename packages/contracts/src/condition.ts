import { z } from "zod";
import { indicatorSpecSchema, type IndicatorSpec } from "./indicator-spec";
import { decimalStringSchema, type DecimalString } from "./scalars";

export const priceFields = ["open", "high", "low", "close", "volume"] as const;
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

export type Condition =
  | { kind: "compare"; left: Operand; comparator: (typeof comparators)[number]; right: Operand }
  | { kind: "and"; conditions: Condition[] }
  | { kind: "or"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("compare"),
      left: operandSchema,
      comparator: z.enum(comparators),
      right: operandSchema,
    }),
    z.strictObject({ kind: z.literal("and"), conditions: z.array(conditionSchema).min(1) }),
    z.strictObject({ kind: z.literal("or"), conditions: z.array(conditionSchema).min(1) }),
    z.strictObject({ kind: z.literal("not"), condition: conditionSchema }),
  ]),
);
