import type { RequestAnalysisActionResult } from "../analysis-actions";
import { t } from "../strings";

export type AnalysisErrorCode = Extract<RequestAnalysisActionResult, { status: "error" }>["error"];

// One plain pt-BR sentence per error code the action can answer
// (docs/adr/0057): exhaustive on the union so a new code fails typecheck
// here rather than falling through silently.
export function analysisErrorMessage(error: AnalysisErrorCode, cap: number): string {
  const errors = t.analysis.errors;
  switch (error) {
    case "invalid":
      return errors.invalid;
    case "not_found":
      return errors.not_found;
    case "not_ready":
      return errors.not_ready;
    case "unavailable":
      return errors.unavailable;
    case "own_key_unreadable":
      return errors.own_key_unreadable;
    case "rate_limited":
      return errors.rate_limited;
    case "rejected":
      return errors.rejected;
    case "failed":
      return errors.failed;
    case "cap_reached":
      return errors.cap_reached(cap);
  }
}
