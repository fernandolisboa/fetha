import { z } from "zod";

// Why a request did not end in an accepted analysis (ADR-0057). `rejected`
// means some reply came back but was unusable: a refusal, a stop reason
// other than `end_turn`/`stop_sequence` (truncation, a context-window cutoff,
// a paused turn...), a schema failure, a citation failure or an outlook
// the facts cannot back (docs/adr/0058) — the call was
// paid, so it counts toward the cap. `failed` means no reply came back at
// all (an Anthropic API error, including a connection or timeout error) and
// does not count. The rejected reply's own text is never part of this: only
// the offending figures or paths, never shown or stored (docs/adr/0057).
export const analysisRejectedReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("schema") }),
  z.strictObject({
    kind: z.literal("citation"),
    uncitedFigures: z.array(z.string()),
    unknownPaths: z.array(z.string()),
  }),
  z.strictObject({ kind: z.literal("refusal") }),
  z.strictObject({ kind: z.literal("incomplete"), stopReason: z.string() }),
  // docs/adr/0058: an outlook naming a fact that holds no ticker, no price,
  // or no expiry after the session.
  z.strictObject({
    kind: z.literal("outlook"),
    problem: z.enum(["instrument_fact", "level_fact", "expiry_fact"]),
  }),
]);
export type AnalysisRejectedReason = z.infer<typeof analysisRejectedReasonSchema>;

export const analysisFailedReasonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("api_error"), status: z.number().int().nullable() }),
]);
export type AnalysisFailedReason = z.infer<typeof analysisFailedReasonSchema>;

export const analysisReasonSchema = z.union([
  analysisRejectedReasonSchema,
  analysisFailedReasonSchema,
]);
export type AnalysisReason = z.infer<typeof analysisReasonSchema>;
