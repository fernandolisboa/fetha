import type { Instant, SessionDate } from "@fetha/contracts";
import { assertDefined } from "./invariant";
import { isAtOrBefore } from "./instant";
import { upperBound } from "./search";

type SessionRow = { session: SessionDate; asOf: Instant };

// One ticker's daily rows (candles or option day prices) sorted by session with a stable sort,
// so rows of one session keep their input order (#58): runBacktest looks a ticker up once per
// session, which scanned every row of the ticker each time.
export type SessionRows<T extends SessionRow> = { rows: T[]; sessions: SessionDate[] };

export function indexBySession<T extends SessionRow>(rows: readonly T[]): SessionRows<T> {
  const sorted = [...rows].sort((a, b) =>
    a.session < b.session ? -1 : a.session > b.session ? 1 : 0,
  );
  return { rows: sorted, sessions: sorted.map((row) => row.session) };
}

// The first-listed row of `session` visible at `visibleAt`: `rows.find(...)` on the input.
export function rowOnSession<T extends SessionRow>(
  index: SessionRows<T> | undefined,
  session: SessionDate,
  visibleAt: Instant,
): T | null {
  if (!index) return null;
  const end = upperBound(index.sessions, session);
  let start = end;
  while (start > 0 && index.sessions[start - 1] === session) start -= 1;
  for (let i = start; i < end; i += 1) {
    const row = assertDefined(index.rows[i], "rowOnSession: index within bounds");
    if (isAtOrBefore(row.asOf, visibleAt)) return row;
  }
  return null;
}

// The row of the latest session up to `upto` that has a row visible at `visibleAt`, the
// first-listed visible one of that session: what reducing the visible rows up to `upto` by a
// strictly later session returns.
export function lastKnownRow<T extends SessionRow>(
  index: SessionRows<T> | undefined,
  upto: SessionDate,
  visibleAt: Instant,
): T | null {
  if (!index) return null;
  let found: T | null = null;
  for (let i = upperBound(index.sessions, upto) - 1; i >= 0; i -= 1) {
    const row = assertDefined(index.rows[i], "lastKnownRow: index within bounds");
    if (found !== null && row.session !== found.session) break;
    if (isAtOrBefore(row.asOf, visibleAt)) found = row;
  }
  return found;
}
