import { z } from "zod";
import { decimalStringSchema } from "./scalars";

export const strikeSelectionKinds = ["delta", "moneyness", "nearest"] as const;

export const strikeSelectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("delta"), target: decimalStringSchema }),
  z.strictObject({ kind: z.literal("moneyness"), percent: decimalStringSchema }),
  z.strictObject({ kind: z.literal("nearest"), price: decimalStringSchema }),
]);
export type StrikeSelection = z.infer<typeof strikeSelectionSchema>;
