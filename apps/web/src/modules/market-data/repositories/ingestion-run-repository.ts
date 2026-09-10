import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import type { IngestionSource, IngestionStatus } from "@/db/schema/market-data";
import { ingestionRuns } from "@/db/schema/market-data";

export interface IngestionRun {
  id: string;
  source: IngestionSource;
  session: string;
  status: IngestionStatus;
  startedAt: Date;
  finishedAt: Date | null;
  rowCount: number | null;
  error: string | null;
}

export async function findSucceededRun(
  db: Database,
  source: IngestionSource,
  session: string,
): Promise<IngestionRun | undefined> {
  const [row] = await db
    .select()
    .from(ingestionRuns)
    .where(
      and(
        eq(ingestionRuns.source, source),
        eq(ingestionRuns.session, session),
        eq(ingestionRuns.status, "succeeded"),
      ),
    )
    .limit(1);
  return row;
}

export async function startRun(
  db: Database,
  source: IngestionSource,
  session: string,
  startedAt: Date = new Date(),
): Promise<string> {
  const [row] = await db
    .insert(ingestionRuns)
    .values({ source, session, status: "running", startedAt })
    .returning({ id: ingestionRuns.id });
  if (!row) {
    throw new Error("failed to start ingestion run");
  }
  return row.id;
}

export async function finishRun(
  db: Database,
  id: string,
  outcome: { status: "succeeded"; rowCount: number } | { status: "failed"; error: string },
  finishedAt: Date = new Date(),
): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      status: outcome.status,
      finishedAt,
      rowCount: outcome.status === "succeeded" ? outcome.rowCount : null,
      error: outcome.status === "failed" ? outcome.error : null,
    })
    .where(eq(ingestionRuns.id, id));
}

// A "running" row whose start is older than the route's maxDuration can only
// mean the previous invocation crashed or was killed by the platform without
// ever reaching finishRun; left as "running" it would wrongly block every
// later retry from ever attempting that (source, session) again.
export async function reapStaleRunningRuns(
  db: Database,
  source: IngestionSource,
  cutoff: Date,
): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      status: "failed",
      finishedAt: sql`now()`,
      error: "reaped: running longer than maxDuration",
    })
    .where(
      and(
        eq(ingestionRuns.source, source),
        eq(ingestionRuns.status, "running"),
        lt(ingestionRuns.startedAt, cutoff),
      ),
    );
}

// A run's own `running` row is discarded, not marked "failed", when a
// concurrent invocation already committed a `succeeded` row for the same
// (source, session): the work was superseded, not lost or broken, and
// marking it "failed" would misreport a benign race as an ingestion failure.
export async function deleteRun(db: Database, id: string): Promise<void> {
  await db.delete(ingestionRuns).where(eq(ingestionRuns.id, id));
}

export async function latestRunPerSource(db: Database): Promise<IngestionRun[]> {
  const rows = await db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt));
  const latestBySource = new Map<IngestionSource, IngestionRun>();
  for (const row of rows) {
    if (!latestBySource.has(row.source)) {
      latestBySource.set(row.source, row);
    }
  }
  return [...latestBySource.values()];
}
