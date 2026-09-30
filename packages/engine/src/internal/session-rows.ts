import type { Instant, SessionDate } from "@fetha/contracts";
import { assertDefined } from "./invariant";
import { compareInstants, isAtOrBefore } from "./instant";
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

// The latest version of `session` visible at `visibleAt`, the first-listed one on a tie: what
// `latestVisible` returns over the session's rows. A restated row replaces the earlier one from
// its own asOf on, whatever the input order (#38, ADR-0055).
export function rowOnSession<T extends SessionRow>(
  index: SessionRows<T> | undefined,
  session: SessionDate,
  visibleAt: Instant,
): T | null {
  if (!index) return null;
  const end = upperBound(index.sessions, session);
  let start = end;
  while (start > 0 && index.sessions[start - 1] === session) start -= 1;
  return latestVisibleIn(index, start, end, visibleAt);
}

// The latest visible version (as rowOnSession reads it) of the latest session up to `upto` that
// has a row visible at `visibleAt`.
export function lastKnownRow<T extends SessionRow>(
  index: SessionRows<T> | undefined,
  upto: SessionDate,
  visibleAt: Instant,
): T | null {
  if (!index) return null;
  let end = upperBound(index.sessions, upto);
  while (end > 0) {
    const session = index.sessions[end - 1];
    let start = end;
    while (start > 0 && index.sessions[start - 1] === session) start -= 1;
    const row = latestVisibleIn(index, start, end, visibleAt);
    if (row !== null) return row;
    end = start;
  }
  return null;
}

function latestVisibleIn<T extends SessionRow>(
  index: SessionRows<T>,
  start: number,
  end: number,
  visibleAt: Instant,
): T | null {
  let latest: T | null = null;
  for (let i = start; i < end; i += 1) {
    const row = assertDefined(index.rows[i], "session-rows: index within bounds");
    if (!isAtOrBefore(row.asOf, visibleAt)) continue;
    if (latest === null || compareInstants(row.asOf, latest.asOf) > 0) latest = row;
  }
  return latest;
}
