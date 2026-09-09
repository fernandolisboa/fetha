import { and, desc, eq } from "drizzle-orm";

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
