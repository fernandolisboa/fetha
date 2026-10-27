// The client-safe entry point: components that run in the browser and the Server Actions they
// call, without pulling Drizzle or the repositories in through the module's main index.
export { SeenTracker } from "./components/seen-tracker";
export { ResearchIdeaCard } from "./components/research-idea-card";
export { researchSummary } from "./research-summary";
export { RESEARCH_WINDOW_SESSIONS } from "./research-rules";
export { t as radarT } from "./strings";
export {
  markSuggestionsSeenAction,
  setSuggestionArchiveAction,
  type MarkSuggestionsSeenResult,
} from "./actions";
