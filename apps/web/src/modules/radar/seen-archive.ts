const HOUR_MS = 60 * 60 * 1000;

export interface SeenArchiveSplit<T> {
  shown: T[];
  archivedSeen: T[];
}

// docs/adr/0074: with a delay chosen, a suggestion leaves the viewer's "Sugestões de hoje" once
// that many hours have passed since they first had it on screen; one they never saw stays.
export function splitSeenSuggestions<T extends { id: string }>(
  suggestions: readonly T[],
  firstSeen: ReadonlyMap<string, Date>,
  afterHours: number | null,
  now: Date,
): SeenArchiveSplit<T> {
  const split: SeenArchiveSplit<T> = { shown: [], archivedSeen: [] };
  for (const suggestion of suggestions) {
    const seenAt = firstSeen.get(suggestion.id);
    const archived =
      afterHours !== null &&
      seenAt !== undefined &&
      now.getTime() - seenAt.getTime() >= afterHours * HOUR_MS;
    (archived ? split.archivedSeen : split.shown).push(suggestion);
  }
  return split;
}
