import type { Instant } from "@fetha/contracts";
import { instantMs } from "./instant";
import { groupBy, upperBound } from "./search";

// Lookup indexes over a MarketView's collections (#58). A backtest asks the same view the same
// kind of question once per session, and every lookup below used to filter and scan the whole
// collection each time. Each index is built once per input array and memoized on that array's
// identity: the engine never mutates its inputs, and callers hand it immutable values
// (ADR-0013), so an index can never go stale. Each query returns exactly the row its linear
// scan returned, ties included.

type Grouped<T> = Map<string, T[]>;

const noRows: readonly never[] = [];

const groupCaches = new WeakMap<(row: never) => string | null, WeakMap<object, Grouped<unknown>>>();

// The rows of `rows` whose `keyOf` is `key`, in the input's own order: the same array
// `rows.filter((row) => keyOf(row) === key)` returns, built once. `keyOf` must be a stable,
// module-level function (the cache is keyed on it); a null key leaves the row out.
export function rowsWithKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  key: string,
): readonly T[] {
  let byRows = groupCaches.get(keyOf) as WeakMap<object, Grouped<T>> | undefined;
  if (!byRows) {
    byRows = new WeakMap();
    groupCaches.set(keyOf, byRows);
  }
  let grouped = byRows.get(rows);
  if (!grouped) {
    grouped = groupBy(rows, keyOf);
    byRows.set(rows, grouped);
  }
  return grouped.get(key) ?? noRows;
}

// `consistent`: asOf strings sort the same way their instants do, equal instants being equal
// strings, which holds for the engine's canonical ISO instants.
type ByAsOf<T> = { rows: T[]; ms: number[]; consistent: boolean };

const asOfCaches = new WeakMap<object, ByAsOf<unknown>>();

// `rows` sorted by asOf (a stable sort, so equal instants keep their input order), with rows
// whose asOf does not parse left out: no `at` ever sees them.
function byAsOf<T extends { asOf: Instant }>(rows: readonly T[]): ByAsOf<T> {
  const cached = asOfCaches.get(rows) as ByAsOf<T> | undefined;
  if (cached) return cached;
  const entries = rows
    .map((row) => ({ row, ms: instantMs(row.asOf) }))
    .filter((entry) => !Number.isNaN(entry.ms))
    .sort((a, b) => a.ms - b.ms);
  const consistent = entries.every((entry, i) => {
    const previous = entries[i - 1];
    if (previous === undefined) return true;
    return previous.ms === entry.ms
      ? previous.row.asOf === entry.row.asOf
      : previous.row.asOf < entry.row.asOf;
  });
  const index = { rows: entries.map((e) => e.row), ms: entries.map((e) => e.ms), consistent };
  asOfCaches.set(rows, index);
  return index;
}

// `latestVisible(rows, at)` without the scan: the earliest-listed row among those sharing the
// latest asOf at or before `at`.
export function latestVisibleIndexed<T extends { asOf: Instant }>(
  rows: readonly T[],
  at: Instant,
): T | null {
  const index = byAsOf(rows);
  let i = upperBound(index.ms, instantMs(at)) - 1;
  if (i < 0) return null;
  const latestMs = index.ms[i];
  while (i > 0 && index.ms[i - 1] === latestMs) i -= 1;
  return index.rows[i] ?? null;
}

// The visible row with the greatest asOf string, the last-listed one on a tie: what sorting the
// visible rows by their asOf strings and taking the last returns. Answered from the index when
// strings and instants agree on the order, by that sort otherwise.
export function lastVisibleByAsOfString<T extends { asOf: Instant }>(
  rows: readonly T[],
  at: Instant,
): T | null {
  const index = byAsOf(rows);
  const atMs = instantMs(at);
  if (!index.consistent) {
    return (
      rows
        .filter((row) => instantMs(row.asOf) <= atMs)
        .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0))
        .at(-1) ?? null
    );
  }
  return index.rows[upperBound(index.ms, atMs) - 1] ?? null;
}
