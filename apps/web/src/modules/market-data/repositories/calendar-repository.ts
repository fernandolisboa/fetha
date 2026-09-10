import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tradingSessions } from "@/db/schema/market-data";

import type { ParsedTradingSession } from "../adapters/anbima-calendar/schema";

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
      },
    });

  return rows.length;
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
): Promise<Array<{ date: string; open: Date; close: Date }>> {
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
