import { assertDefined } from "./invariant";

// The number of leading entries of an ascending array that are <= `value`: the insertion point
// after every equal entry. A NaN `value` is never >= anything, so it yields 0.
export function upperBound<T extends number | string>(sorted: readonly T[], value: T): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (assertDefined(sorted[mid], "upperBound: index within bounds") <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

// `rows` bucketed by `keyOf`, each bucket in the input's own order; a null key leaves the row out.
export function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K | null): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}
