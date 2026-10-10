import { z } from "zod";

// Why a request did not end in an accepted analysis (ADR-0057). `rejected`
// means the model answered but the reply failed the output contract or the
// citation check; `failed` means no usable reply ever came back. The
// rejected reply's own text is never part of this: only the offending
// figures or paths, never shown or stored (docs/adr/0057).
export const analysisRejectedReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("schema") }),
  z.strictObject({
    kind: z.literal("citation"),
    uncitedFigures: z.array(z.string()),
    unknownPaths: z.array(z.string()),
  }),
]);
export type AnalysisRejectedReason = z.infer<typeof analysisRejectedReasonSchema>;

export const analysisFailedReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("refusal") }),
  z.strictObject({ kind: z.literal("max_tokens") }),
  z.strictObject({ kind: z.literal("api_error"), status: z.number().int().nullable() }),
]);
export type AnalysisFailedReason = z.infer<typeof analysisFailedReasonSchema>;

export const analysisReasonSchema = z.union([
  analysisRejectedReasonSchema,
  analysisFailedReasonSchema,
]);
export type AnalysisReason = z.infer<typeof analysisReasonSchema>;
