import { z } from "zod";
import { decimalStringSchema, tickerSchema } from "./scalars";

export const thesisClaimKinds = ["close_above", "close_below", "operation_pnl_positive"] as const;

export const thesisClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("close_above"),
    instrument: tickerSchema,
    level: decimalStringSchema,
  }),
  z.strictObject({
    kind: z.literal("close_below"),
    instrument: tickerSchema,
    level: decimalStringSchema,
  }),
  z.strictObject({ kind: z.literal("operation_pnl_positive") }),
]);
export type ThesisClaim = z.infer<typeof thesisClaimSchema>;
