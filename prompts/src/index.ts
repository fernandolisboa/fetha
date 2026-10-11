import type { AnalysisInputs, AnalysisSubjectKind } from "@fetha/contracts";

import * as analysisV1 from "./analysis/v1";

export interface AnalysisPrompt {
  version: string;
  system: string;
  render: (inputs: AnalysisInputs) => string;
}

// The prompt every new request uses; older versions stay importable so a
// stored request always names text that still exists in the repository.
export const analysisPrompt: AnalysisPrompt = analysisV1;

export type AnalysisModel = "claude-opus-5-5" | "claude-sonnet-5-5";

// ADR-0009: Opus for thesis and counter-thesis on capital at stake and for
// strategy critique, Sonnet for the routine daily report a signal is.
export const analysisModels: Record<AnalysisSubjectKind, AnalysisModel> = {
  signal: "claude-sonnet-5-5",
  contemplated_operation: "claude-opus-5-5",
  held_operation: "claude-opus-5-5",
  backtest_run: "claude-opus-5-5",
};
