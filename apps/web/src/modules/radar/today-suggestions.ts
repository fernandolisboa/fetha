import type { SessionDate } from "@fetha/contracts";

import type { SuggestionView } from "./suggestion-view";

export type TodaySuggestionsResult =
  | { kind: "open"; session: SessionDate; overdueSessions: number; suggestions: SuggestionView[] }
  | { kind: "none" };

// docs/adr/0073: the newest read session's suggestions, ordered like the radar's rows (by how
// many option series traded at the close, never by a score), with how many later closes the
// radar is overdue on so the panel can say how old they are.
export function todaySuggestions(
  session: SessionDate,
  overdueSessions: number,
  views: readonly SuggestionView[],
): TodaySuggestionsResult {
  if (views.length === 0) return { kind: "none" };
  return {
    kind: "open",
    session,
    overdueSessions,
    suggestions: [...views].sort(
      (a, b) =>
        (b.reading?.options.tradedSeries ?? 0) - (a.reading?.options.tradedSeries ?? 0) ||
        a.underlying.localeCompare(b.underlying) ||
        a.recipeId.localeCompare(b.recipeId),
    ),
  };
}
