export type SortUniqueResult<T> = { ok: true; value: T[] } | { ok: false; duplicateKey: string };

export function sortedEntries(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function sortUnique<T>(
  rows: readonly T[],
  key: (row: T) => string,
  compare: (a: T, b: T) => number,
): SortUniqueResult<T> {
  const sorted = [...rows].sort(compare);
  const seen = new Set<string>();
  for (const row of sorted) {
    const k = key(row);
    if (seen.has(k)) return { ok: false, duplicateKey: k };
    seen.add(k);
  }
  return { ok: true, value: sorted };
}
