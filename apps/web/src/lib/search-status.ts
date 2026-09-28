export interface SearchOutcomeState {
  pending: boolean;
  rateLimited: boolean;
  searchFailed: boolean;
}

export interface SearchStatusMessages {
  searching: string;
  rateLimited: string;
  searchError: string;
  empty: string;
}

// One derivation for both the visible copy (CommandLoading/CommandEmpty)
// and the announced copy (CommandStatus), so they cannot drift apart.
export function deriveSearchMessage(
  state: SearchOutcomeState,
  messages: SearchStatusMessages,
): string {
  if (state.pending) {
    return messages.searching;
  }
  if (state.rateLimited) {
    return messages.rateLimited;
  }
  if (state.searchFailed) {
    return messages.searchError;
  }
  return messages.empty;
}

// The live region only holds text once the user has typed something and
// there is nothing to show for it: an untouched search box never
// announces, and a query with results stays silent so the screen reader
// user isn't told "no instrument found" while options are listed.
export function deriveSearchStatusText(
  message: string,
  params: { trimmedQueryLength: number; hasResults: boolean },
): string {
  return params.trimmedQueryLength > 0 && !params.hasResults ? message : "";
}
