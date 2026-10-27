import type {
  EngineResearchView,
  ObtainSuggestionsResult,
  ResearchNotice,
} from "./research-actions";
import type { ResearchView } from "./research-view";

export interface ResearchPanelState {
  engine: EngineResearchView | null;
  research: ResearchView | null;
  notice: ResearchNotice | null;
  error: "rate_limited" | "unavailable" | null;
}

// The stored research the page loaded with, if any; the engine's result only exists after a click.
export function initialPanelState(stored: ResearchView | null): ResearchPanelState {
  return { engine: null, research: stored, notice: null, error: null };
}

// A research that ran replaces what was on screen, the stored one included: the new opinion, or
// the engine's numbers with a notice saying why there is none. One that did not run (the rate
// limit, say) says so next to the button and leaves the last good result where it was.
export function applyObtained(
  previous: ResearchPanelState,
  outcome: ObtainSuggestionsResult,
): ResearchPanelState {
  return outcome.status === "ok"
    ? { engine: outcome.engine, research: outcome.research, notice: outcome.notice, error: null }
    : { ...previous, error: outcome.error };
}
