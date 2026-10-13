import { z } from "zod";
import { decimalStringSchema, tickerSchema } from "./scalars";

export const thesisClaimKinds = ["close_above", "close_below", "operation_pnl_positive"] as const;

const closeAboveClaimSchema = z.strictObject({
  kind: z.literal("close_above"),
  instrument: tickerSchema,
  level: decimalStringSchema,
});
const closeBelowClaimSchema = z.strictObject({
  kind: z.literal("close_below"),
  instrument: tickerSchema,
  level: decimalStringSchema,
});

export const thesisClaimSchema = z.discriminatedUnion("kind", [
  closeAboveClaimSchema,
  closeBelowClaimSchema,
  z.strictObject({ kind: z.literal("operation_pnl_positive") }),
]);
export type ThesisClaim = z.infer<typeof thesisClaimSchema>;

// An analysis has no operation, so its outlook only ever claims a close
// (docs/adr/0058).
export const analysisOutlookClaimSchema = z.discriminatedUnion("kind", [
  closeAboveClaimSchema,
  closeBelowClaimSchema,
]);
export type AnalysisOutlookClaim = z.infer<typeof analysisOutlookClaimSchema>;
