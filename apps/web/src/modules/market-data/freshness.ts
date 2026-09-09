import type { Database } from "@/db/client";
import type { IngestionSource } from "@/db/schema/market-data";

import { latestSessionOnOrBefore } from "./repositories/calendar-repository";
import { latestRunPerSource } from "./repositories/ingestion-run-repository";

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
