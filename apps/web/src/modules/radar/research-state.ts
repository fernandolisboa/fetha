import type { ResearchResult } from "./research";
import type { ResearchSuggestionsActionResult } from "./research-actions";

export interface ResearchState {
  result: ResearchResult | null;
  error: "rate_limited" | "unavailable" | null;
}

export const initialResearchState: ResearchState = { result: null, error: null };

// A failed research (the rate limit, say) says so next to the button and leaves the last good
// result on screen.
export function applyOutcome(
  previous: ResearchState,
  outcome: ResearchSuggestionsActionResult,
): ResearchState {
  return outcome.status === "ok"
    ? { result: outcome.result, error: null }
    : { result: previous.result, error: outcome.error };
}
