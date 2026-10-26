const MINUTE_MS = 60 * 1000;

export interface SeenArchiveSplit<T> {
  shown: T[];
  archivedSeen: T[];
}

// docs/adr/0074: with a delay chosen, a suggestion leaves the viewer's "Sugestões de hoje" once
// that many minutes have passed since they first had it on screen; one they never saw stays.
export function splitSeenSuggestions<T extends { id: string }>(
  suggestions: readonly T[],
  firstSeen: ReadonlyMap<string, Date>,
  afterMinutes: number | null,
  now: Date,
): SeenArchiveSplit<T> {
  const split: SeenArchiveSplit<T> = { shown: [], archivedSeen: [] };
  for (const suggestion of suggestions) {
    const seenAt = firstSeen.get(suggestion.id);
    const archived =
      afterMinutes !== null &&
      seenAt !== undefined &&
      now.getTime() - seenAt.getTime() >= afterMinutes * MINUTE_MS;
    (archived ? split.archivedSeen : split.shown).push(suggestion);
  }
  return split;
}
