import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";

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
): Promise<Array<{ date: string; open: Date; close: Date }>> {
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
