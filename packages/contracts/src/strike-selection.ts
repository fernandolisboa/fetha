import { z } from "zod";
import { decimalStringSchema, openUnitIntervalSchema, positiveDecimalSchema } from "./scalars";

export const strikeSelectionKinds = ["delta", "moneyness", "nearest"] as const;

export const strikeSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("delta"), target: openUnitIntervalSchema }),
  z.strictObject({ kind: z.literal("moneyness"), percent: decimalStringSchema }),
  z.strictObject({ kind: z.literal("nearest"), price: positiveDecimalSchema }),
]);
export type StrikeSelection = z.infer<typeof strikeSelectionSchema>;
