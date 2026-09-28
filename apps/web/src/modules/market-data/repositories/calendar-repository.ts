import { and, asc, desc, eq, gt, gte, lt, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles, optionDailyPrices, tradingSessions } from "../schema";

import type { ParsedTradingSession } from "../adapters/anbima-calendar/schema";

export type DeleteUnlistedTradingSessionsResult =
  { kind: "removed"; removed: number } | { kind: "blocked"; dates: string[] };

export async function upsertTradingSessions(
  db: Database,
  rows: ParsedTradingSession[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(tradingSessions)
    .values(
      rows.map((row) => ({
        date: row.date,
        open: new Date(row.open),
        close: new Date(row.close),
      })),
    )
    .onConflictDoUpdate({
      target: tradingSessions.date,
      set: {
        open: sql`excluded.open`,
        close: sql`excluded.close`,
        asOf: sql`now()`,
      },
      // The nightly ingestion re-writes the whole calendar: only a real revision may move
      // `as_of`, since it feeds a backtest's dataVersion and a moved one fails the run.
      setWhere: sql`(${tradingSessions.open}, ${tradingSessions.close}) is distinct from (excluded.open, excluded.close)`,
    });

  return rows.length;
}

// A calendar source lists a whole year, so a date in that year it no longer lists (a holiday
// declared after the fact, a corrected ANBIMA file) stops being a session. Deleting it cannot move
// `max(as_of)` over the rows that remain, so the same statement re-stamps every surviving session:
// a backtest whose window saw the removed date then fails with data_version_changed instead of
// resuming on a different calendar (ADR-0017). The update must skip the deleted rows: when one
// statement modifies a row twice, Postgres applies only one of the two, unpredictably, so an
// unguarded update could win and keep the removed date.
//
// A holiday has no COTAHIST file, so a candidate date with rows in `candles` or
// `option_daily_prices` means the correction, not the market data, is wrong: deleting the
// session would silently leave a bar indicators and backtests still count while the session
// count no longer does (#189). The whole year's delete is all-or-nothing: if any candidate is
// blocked, none of that year's candidates are removed and none are re-stamped, reported back as
// `{ kind: "blocked" }` so the caller can name the offending dates instead of guessing which one.
//
// The block check, the delete and the re-stamp read one MVCC snapshot together, which is only
// enough to keep the three of them consistent *with each other* — it does not by itself stop a
// `upsertDailyCandles`/`upsertOptionDailyPrices` write that starts and commits in a fully separate
// transaction while this one is running from landing on a candidate date invisibly to `blocked`.
// The actual guarantee against that race is `ingest.ts`'s `removeUnlistedSessions`, which calls
// this function from inside `withSourceLock(db, "cotahist", ...)` — the same lock every cotahist
// write (`runSource("cotahist", ...)`) takes before touching `candles` or `option_daily_prices`.
// `pg_advisory_xact_lock` blocks rather than failing fast, so the two can never interleave: either
// a concurrent cotahist write fully commits (and releases the lock) before this transaction's
// snapshot is taken, or it cannot even start until this transaction commits or rolls back. A
// caller that invokes this function outside that lock gets no such guarantee.
export async function deleteUnlistedTradingSessions(
  db: Database,
  year: number,
  listedSessions: ParsedTradingSession[],
): Promise<DeleteUnlistedTradingSessionsResult> {
  if (listedSessions.length === 0) {
    return { kind: "removed", removed: 0 };
  }
  const listed = sql.join(
    listedSessions.map((session) => sql`${session.date}::date`),
    sql`, `,
  );
  const result = await db.execute<{ removed: number; blocked: string[] | null }>(sql`
    with candidates as (
      select ${tradingSessions.date} as date
      from ${tradingSessions}
      where ${tradingSessions.date} between ${`${String(year)}-01-01`}::date and ${`${String(year)}-12-31`}::date
        and ${tradingSessions.date} not in (${listed})
    ),
    blocked as (
      select candidates.date
      from candidates
      where exists (select 1 from ${candles} where ${candles.session} = candidates.date)
         or exists (select 1 from ${optionDailyPrices} where ${optionDailyPrices.session} = candidates.date)
    ),
    removed as (
      delete from ${tradingSessions}
      where ${tradingSessions.date} in (select date from candidates)
        and not exists (select 1 from blocked)
      returning ${tradingSessions.date}
    ),
    restamped as (
      update ${tradingSessions} set ${sql.identifier(tradingSessions.asOf.name)} = now()
      where exists (select 1 from removed)
        and ${tradingSessions.date} not in (select date from removed)
      returning 1
    )
    select
      (select count(*)::int from removed) as removed,
      (select array_agg(date::text order by date) from blocked) as blocked
  `);
  const row = result.rows[0];
  if (row?.blocked) {
    return { kind: "blocked", dates: row.blocked };
  }
  return { kind: "removed", removed: row?.removed ?? 0 };
}

export async function latestSessionOnOrBefore(
  db: Database,
  at: Date,
): Promise<{ date: string; open: Date; close: Date } | undefined> {
  const [row] = await db
    .select()
    .from(tradingSessions)
    .where(lte(tradingSessions.close, at))
    .orderBy(desc(tradingSessions.date))
    .limit(1);
  return row;
}

// The last `limit` closed trading sessions on or before `at`, oldest first:
// the bounded window `targetSessionForSource` (ingest.ts) searches for the
// oldest gap in a source's ingestion, so a session that keeps failing is
// retried instead of being permanently skipped once a newer session closes
// (docs/adr/0017).
export async function recentSessions(
  db: Database,
  at: Date,
  limit: number,
): Promise<Array<{ date: string; open: Date; close: Date }>> {
  const rows = await db
    .select()
    .from(tradingSessions)
    .where(lte(tradingSessions.close, at))
    .orderBy(desc(tradingSessions.date))
    .limit(limit);
  return rows.reverse();
}

// The first trading session on or after `date`: a
// stored horizon can land on a weekend or a holiday (nothing stops a user
// from typing one in), and the decision is due once trading actually
// reaches it, not on the calendar date itself — the same "closes above a
// level" claim on a Saturday can only ever resolve against the following
// Monday's close.
export async function sessionOnOrAfter(
  db: Database,
  date: string,
): Promise<{ date: string; open: Date; close: Date } | undefined> {
  const [row] = await db
    .select()
    .from(tradingSessions)
    .where(gte(tradingSessions.date, date))
    .orderBy(asc(tradingSessions.date))
    .limit(1);
  return row;
}

export async function sessionByDate(
  db: Database,
  date: string,
): Promise<{ date: string; open: Date; close: Date } | undefined> {
  const [row] = await db
    .select()
    .from(tradingSessions)
    .where(eq(tradingSessions.date, date))
    .limit(1);
  return row;
}

// Every session with close <= at, oldest first, unbounded: the reference
// calendar table holds every B3 trading day since FIRST_INGESTED_CALENDAR_YEAR
// (a few thousand rows at most), so a full scan up to `at` is cheap and lets
// the engine's `dataWindow` count back past any indicator's warm-up without
// this repository having to guess a lookback bound (#19).
export async function sessionsUpTo(
  db: Database,
  at: Date,
): Promise<Array<{ date: string; open: Date; close: Date }>> {
  return db
    .select()
    .from(tradingSessions)
    .where(lte(tradingSessions.close, at))
    .orderBy(asc(tradingSessions.date));
}

// Every session overlapping [from, to], oldest first: the bounded slice a
// `DataWindow`-driven MarketView needs (#19), so a strategy's evaluation
// never sees a calendar row after its own `at`.
export async function sessionsInRange(
  db: Database,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; open: Date; close: Date; asOf: Date }>> {
  return db
    .select()
    .from(tradingSessions)
    .where(and(gte(tradingSessions.close, from), lte(tradingSessions.open, to)))
    .orderBy(asc(tradingSessions.date));
}

// The trading session immediately before `date`, or undefined if `date` is
// the calendar's first session: the nightly evaluation's `since` anchor
// (#19) is this session's close, so a multi-session catch-up starts right
// after the last session that was already caught up, not the candle's own
// (possibly stale) session.
export async function sessionBefore(
  db: Database,
  date: string,
): Promise<{ date: string; open: Date; close: Date } | undefined> {
  const [row] = await db
    .select()
    .from(tradingSessions)
    .where(lt(tradingSessions.date, date))
    .orderBy(desc(tradingSessions.date))
    .limit(1);
  return row;
}

export async function sessionsFrom(
  db: Database,
  from: string,
): Promise<Array<{ date: string; open: string }>> {
  const rows = await db
    .select({ date: tradingSessions.date, open: tradingSessions.open })
    .from(tradingSessions)
    .where(gte(tradingSessions.date, from))
    .orderBy(asc(tradingSessions.date));
  return rows.map((row) => ({ date: row.date, open: row.open.toISOString() }));
}

// The calendar `buildOperationMarketView` needs to resolve time to expiry
// for every leg of a chain (`resolveTimeToExpiryYears`, ADR-0013): the
// engine's calendar walk requires the session containing `at` (found by
// `open <= at`, not `close <= at` — the current session is live until its
// close) and every session between it and the furthest expiry in the
// chain, with no gap, or `resolveTimeToExpiryYears` reports `calendar_gap`.
export async function calendarWindowThroughExpiry(
  db: Database,
  at: Date,
  pastWindow: number,
  throughExpiry: string | null,
): Promise<Array<{ date: string; open: Date; close: Date; asOf: Date }>> {
  const pastRows = await db
    .select()
    .from(tradingSessions)
    .where(lte(tradingSessions.open, at))
    .orderBy(desc(tradingSessions.date))
    .limit(pastWindow);

  const futureRows = throughExpiry
    ? await db
        .select()
        .from(tradingSessions)
        .where(and(gt(tradingSessions.open, at), lte(tradingSessions.date, throughExpiry)))
        .orderBy(asc(tradingSessions.date))
    : [];

  return [...pastRows.reverse(), ...futureRows];
}
