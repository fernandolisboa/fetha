import { z } from "zod";

import {
  analysisVerdicts,
  checkProseCitations,
  factAt,
  type AnalysisCitationCheck,
  type AnalysisInputs,
} from "./analysis";

// The most ideas one research sends to the model (docs/adr/0076); the rest are shown engine-only.
export const MAX_RESEARCH_IDEAS_SENT = 20;

// The reply's token budget (docs/adr/0076): twenty ideas at the largest the bounds below allow come to about 10 000
// tokens of JSON, and the model's own thinking is billed against the same limit. Past this the
// reply is cut off and rejected as incomplete.
export const RESEARCH_MAX_OUTPUT_TOKENS = 20_000;

export const researchAlerts = [
  "negative_news",
  "recent_filing",
  "rule_no_longer_holds",
  "limit_breach",
  "near_expiry",
  "low_liquidity",
  "weak_track_record",
  "iv_regime_mismatch",
  "trend_against",
] as const;
export const researchAlertSchema = z.enum(researchAlerts);
export type ResearchAlert = z.infer<typeof researchAlertSchema>;

const prose = (max: number) => z.string().trim().min(1).max(max);

// `research@1` (docs/adr/0076): one verdict per idea sent, words from closed lists plus prose whose
// every figure is a figure of the facts. No outlook and no likelihood: an idea is scored on the
// lot the engine priced, never on a number the model wrote.
export const researchIdeaOutputSchema = z.strictObject({
  idea: z.string().min(1).max(40),
  verdict: z.enum(analysisVerdicts),
  justification: prose(600),
  alerts: z
    .array(researchAlertSchema)
    .max(5)
    .refine((alerts) => new Set(alerts).size === alerts.length, {
      message: "alerts must not repeat",
    }),
  inputsCited: z.array(z.string().min(1).max(80)).min(1).max(8),
});
export type ResearchIdeaOutput = z.infer<typeof researchIdeaOutputSchema>;

export const researchOutputSchema = z.strictObject({
  overview: prose(800),
  ideas: z.array(researchIdeaOutputSchema).min(1).max(MAX_RESEARCH_IDEAS_SENT),
});
export type ResearchOutput = z.infer<typeof researchOutputSchema>;

export type ResearchIdeasProblem = "missing" | "duplicate" | "unknown";

export type ResearchIdeasCheck = { ok: true } | { ok: false; problem: ResearchIdeasProblem };

export function researchIdeaPath(position: number): string {
  return `ideas.${String(position)}`;
}

// The reply must answer every idea sent, exactly once, and only those. Unknown paths come first
// in the problem reported, then repeats, then omissions.
export function checkResearchIdeas(
  inputs: AnalysisInputs,
  output: ResearchOutput,
): ResearchIdeasCheck {
  const sent = factAt(inputs.facts, "ideas");
  const sentPaths = new Set(
    Array.isArray(sent) ? sent.map((_, position) => researchIdeaPath(position)) : [],
  );
  const answered = output.ideas.map((entry) => entry.idea);
  if (answered.some((path) => !sentPaths.has(path))) return { ok: false, problem: "unknown" };
  if (new Set(answered).size !== answered.length) return { ok: false, problem: "duplicate" };
  if (answered.length !== sentPaths.size) return { ok: false, problem: "missing" };
  return { ok: true };
}

// docs/adr/0057 over every sentence the reply writes: the overview and each justification, against
// all the facts, plus every path an idea cites.
export function checkResearchCitations(
  inputs: AnalysisInputs,
  output: ResearchOutput,
): AnalysisCitationCheck {
  return checkProseCitations(
    inputs,
    [output.overview, ...output.ideas.map((entry) => entry.justification)],
    output.ideas.flatMap((entry) => entry.inputsCited),
  );
}
