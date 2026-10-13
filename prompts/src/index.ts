import {
  analysisOutputV3Schema,
  filingLabelOutputSchema,
  type FilingLabelInputs,
  type AnalysisInputs,
  type AnalysisSubjectKind,
} from "@fetha/contracts";

import * as analysisV3 from "./analysis/v3";
import * as filingLabelV1 from "./filing-label/v1";

export interface AnalysisPrompt {
  version: string;
  system: string;
  render: (inputs: AnalysisInputs) => string;
  // The contract a reply to this version is checked against (docs/adr/0067).
  outputSchema: typeof analysisOutputV3Schema;
}

// The prompt every new request uses; older versions stay in `./analysis/`
// so a stored request always names text that still exists in the repository.
export const analysisPrompt: AnalysisPrompt = {
  ...analysisV3,
  outputSchema: analysisOutputV3Schema,
};

export type AnalysisModel = "claude-opus-5-5" | "claude-sonnet-5-5";

// ADR-0009: Opus for thesis and counter-thesis on capital at stake and for
// strategy critique, Sonnet for the routine daily report a signal is. A
// suggestion puts capital at stake like an operation (docs/adr/0067).
export const analysisModels: Record<AnalysisSubjectKind, AnalysisModel> = {
  signal: "claude-sonnet-5-5",
  contemplated_operation: "claude-opus-5-5",
  held_operation: "claude-opus-5-5",
  backtest_run: "claude-opus-5-5",
  suggestion: "claude-opus-5-5",
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

// docs/adr/0065: the cheapest current model; a label is a closed-list
// classification and one plain sentence.
export const filingLabelModel = "claude-haiku-5-5";
