import {
  analysisOutputV3Schema,
  filingLabelOutputSchema,
  researchOutputSchema,
  type FilingLabelInputs,
  type AnalysisInputs,
  type AnalysisObjectKind,
  type AnalysisSubjectKind,
  type ModelFamily,
} from "@fetha/contracts";

import * as analysisV3 from "./analysis/v3";
import * as filingLabelV1 from "./filing-label/v1";
import * as researchV1 from "./research/v1";

export interface AnalysisPrompt {
  version: string;
  system: string;
  render: (inputs: AnalysisInputs & { subject: AnalysisObjectKind }) => string;
  // The contract a reply to this version is checked against (docs/adr/0067).
  outputSchema: typeof analysisOutputV3Schema;
}

// The prompt every new request uses; older versions stay in `./analysis/`
// so a stored request always names text that still exists in the repository.
export const analysisPrompt: AnalysisPrompt = {
  ...analysisV3,
  outputSchema: analysisOutputV3Schema,
};

export interface ResearchPrompt {
  version: string;
  system: string;
  render: (inputs: AnalysisInputs) => string;
  // The contract a reply is checked against (docs/adr/0076).
  outputSchema: typeof researchOutputSchema;
}

// The prompt of "Obter sugestões" (docs/adr/0076): one call over all the ideas of a research,
// apart from the single-object analysis above because its contract, checks and fixtures differ.
export const researchPrompt: ResearchPrompt = {
  ...researchV1,
  outputSchema: researchOutputSchema,
};

// The 5.5-generation id of each family: the floor `apps/web`'s model
// resolver never returns anything older than, and what every call falls
// back to when the Models API is unreachable or no key is configured
// (docs/adr/0068).
export const pinnedModels: Record<ModelFamily, string> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

// ADR-0009: Opus for thesis and counter-thesis on capital at stake and for
// strategy critique, Sonnet for the routine daily report a signal is. A
// suggestion puts capital at stake like an operation (docs/adr/0067). A
// family rather than a pinned id, so a user who keeps the default picks up
// a newer release automatically (docs/adr/0068).
export const defaultAnalysisFamilies: Record<AnalysisSubjectKind, ModelFamily> = {
  signal: "sonnet",
  contemplated_operation: "opus",
  held_operation: "opus",
  backtest_run: "opus",
  suggestion: "opus",
  // Opus judges ideas that put capital at stake, like a suggestion's own analysis (docs/adr/0076).
  research: "opus",
};

export interface FilingLabelPrompt {
  version: string;
  system: string;
  render: (inputs: FilingLabelInputs) => string;
  outputSchema: typeof filingLabelOutputSchema;
}

export const filingLabelPrompt: FilingLabelPrompt = {
  ...filingLabelV1,
  outputSchema: filingLabelOutputSchema,
};

// docs/adr/0065 / docs/adr/0068: the cheapest family; a label is a
// closed-list classification and one plain sentence. Haiku has no
// server-side fallback, so its client sends no `fallbacks`.
export const filingLabelFamily: ModelFamily = "haiku";
