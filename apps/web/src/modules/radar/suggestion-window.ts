import type { SessionDate } from "@fetha/contracts";

export interface SuggestionWindow {
  openThrough: SessionDate;
  archived: boolean;
}

// docs/adr/0072: a suggestion speaks for the close it was scanned on, so it is "today's" through
// the São Paulo day of the next trading session, the one day anyone can act on that close, and
// archived from the day after. A calendar that does not reach the next session yet closes it on
// its own session's day rather than leaving it open forever.
export function suggestionWindow(
  session: SessionDate,
  nextSession: SessionDate | undefined,
  today: SessionDate,
): SuggestionWindow {
  const openThrough = nextSession ?? session;
  return { openThrough, archived: today > openThrough };
}
