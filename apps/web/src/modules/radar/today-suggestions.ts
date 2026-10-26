import type { SessionDate } from "@fetha/contracts";

import type { SuggestionValidity } from "./suggestion-validity";
import type { SuggestionView } from "./suggestion-view";

export type TodaySuggestionsResult =
  | { kind: "open"; suggestions: SuggestionView[] }
  | { kind: "archived"; session: SessionDate; openThrough: SessionDate }
  | { kind: "none" };

// docs/adr/0072: the newest read session's suggestions while they are open, ordered like the
// radar's rows (by how many option series traded at the close, never by a score); once archived,
// only which close they came from and when they closed, never anything older in their place.
export function todaySuggestions(
  session: SessionDate,
  validity: SuggestionValidity,
  views: readonly SuggestionView[],
): TodaySuggestionsResult {
  if (views.length === 0) return { kind: "none" };
  if (validity.archived) return { kind: "archived", session, openThrough: validity.openThrough };
  return {
    kind: "open",
    suggestions: [...views].sort(
      (a, b) =>
        (b.reading?.options.tradedSeries ?? 0) - (a.reading?.options.tradedSeries ?? 0) ||
        a.underlying.localeCompare(b.underlying) ||
        a.recipeId.localeCompare(b.recipeId),
    ),
  };
}
