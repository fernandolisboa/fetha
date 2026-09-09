import type { Database } from "@/db/client";
import { ingestionSourceValues, type IngestionSource } from "@/db/schema/market-data";

import { latestSessionOnOrBefore, recentSessions } from "./repositories/calendar-repository";
import { findSucceededRun, latestRunPerSource } from "./repositories/ingestion-run-repository";

const RECENT_SESSION_WINDOW = 10;

export interface SourceFreshness {
  source: IngestionSource;
  status: "running" | "succeeded" | "failed";
  session: string;
  finishedAt: Date | null;
}

// Market-data's public freshness surface (CONTEXT.md "exposes"): the last
// trading session on or before `at`, and the last ingestion run recorded per
// source. The market bar (#13) reads both.
export async function latestSession(db: Database, at: Date = new Date()): Promise<string | null> {
  const session = await latestSessionOnOrBefore(db, at);
  return session?.date ?? null;
}

export async function freshness(db: Database): Promise<SourceFreshness[]> {
  const runs = await latestRunPerSource(db);
  return runs.map((run) => ({
    source: run.source,
    status: run.status,
    session: run.session,
    finishedAt: run.finishedAt,
  }));
}

// Sessions among the last RECENT_SESSION_WINDOW closed on/before `at` with no
// succeeded ingestion run for the given source; empty when fully caught up.
export async function gaps(
  db: Database,
  source: IngestionSource,
  at: Date = new Date(),
): Promise<string[]> {
  const sessions = await recentSessions(db, at, RECENT_SESSION_WINDOW);
  const result: string[] = [];
  for (const session of sessions) {
    const run = await findSucceededRun(db, source, session.date);
    if (!run) {
      result.push(session.date);
    }
  }
  return result;
}

// "calendar" is excluded: its natural key is a once-a-year marker session,
// not one of the trading sessions this window scans.
const SESSION_BOUND_SOURCES = ingestionSourceValues.filter((source) => source !== "calendar");

export async function allGaps(
  db: Database,
  at: Date = new Date(),
): Promise<Record<IngestionSource, string[]>> {
  const entries = await Promise.all(
    SESSION_BOUND_SOURCES.map(async (source) => [source, await gaps(db, source, at)] as const),
  );
  return Object.fromEntries(entries) as Record<IngestionSource, string[]>;
}
