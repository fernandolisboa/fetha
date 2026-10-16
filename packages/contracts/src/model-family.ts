import { z } from "zod";

// A model family, not a pinned id: picking one lets the resolver follow
// Anthropic's own newest release of that family (docs/adr/0068) instead of
// naming a version here that goes stale.
export const modelFamilies = ["haiku", "sonnet", "opus"] as const;
export const modelFamilySchema = z.enum(modelFamilies);
export type ModelFamily = z.infer<typeof modelFamilySchema>;

// "default" defers to the kind's own default family (`@fetha/prompts`'
// `defaultAnalysisFamilies`) rather than storing it, so a later change to
// that default reaches a user who never picked one explicitly.
export const analysisModelFamilyChoices = ["default", ...modelFamilies] as const;
export const analysisModelFamilyChoiceSchema = z.enum(analysisModelFamilyChoices);
export type AnalysisModelFamilyChoice = z.infer<typeof analysisModelFamilyChoiceSchema>;

// Stored as a partial record: a kind absent here simply has no override.
export const aiSettingsModelFamiliesSchema = z
  .object({
    signal: modelFamilySchema,
    contemplated_operation: modelFamilySchema,
    held_operation: modelFamilySchema,
    backtest_run: modelFamilySchema,
    suggestion: modelFamilySchema,
  })
  .partial()
  .strict();
export type AiSettingsModelFamilies = z.infer<typeof aiSettingsModelFamiliesSchema>;
