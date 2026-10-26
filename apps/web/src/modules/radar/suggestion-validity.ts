import type { SessionDate } from "@fetha/contracts";

export type SuggestionValidity =
  { archived: false } | { archived: true; supersededBy: SessionDate };

// docs/adr/0073: a suggestion speaks for the close it was scanned on until the radar reads a newer
// close, whatever the date is. A night without ingestion keeps it current instead of leaving the
// panel empty; the newer reading is what archives it.
export function suggestionValidity(
  session: SessionDate,
  newestReadSession: SessionDate | null,
): SuggestionValidity {
  return newestReadSession !== null && newestReadSession > session
    ? { archived: true, supersededBy: newestReadSession }
    : { archived: false };
}
