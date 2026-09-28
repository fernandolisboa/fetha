import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { postgresErrorOf } from "@/db/pg-error";

import { nightlyRuns } from "./schema";
import {
  NIGHTLY_RUN_RETENTION_DAYS,
  purgeExpiredNightlyRuns,
  recordNightlyRun,
} from "./nightly-runs-repository";

const createdIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const id of createdIds.splice(0)) {
    await db.delete(nightlyRuns).where(eq(nightlyRuns.id, id));
  }
});

async function insertRawRun(startedAt: Date): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(nightlyRuns)
    .values({
      trigger: "cron",
      startedAt,
      finishedAt: startedAt,
      ok: true,
      report: {
        session: null,
        okSessions: [],
        sources: [],
        accessLogPurge: { ok: true, deleted: 0 },
        unverifiedAccountPurge: { ok: true, deleted: 0 },
        sessionPurge: { ok: true, deleted: 0 },
        nightlyRunPurge: { ok: true, deleted: 0 },
        evaluation: null,
        scoring: { decisionsScored: 0, usersSkipped: 0, decisionsSkipped: 0, errorCount: 0 },
      },
    })
    .returning({ id: nightlyRuns.id });
  if (!row) {
    throw new Error("failed to insert test nightly run");
  }
  createdIds.push(row.id);
  return row.id;
}

describe("nightly_runs (docs/adr/0044)", () => {
  it("records one row per run with the given trigger, ok flag and report", async () => {
    const db = getDb();
    const startedAt = new Date("2026-09-08T02:00:00Z");
    const finishedAt = new Date("2026-09-08T02:05:00Z");

    await recordNightlyRun(db, {
      trigger: "manual",
      startedAt,
      finishedAt,
      ok: true,
      report: {
        session: "2026-09-08",
        okSessions: ["2026-09-08"],
        sources: [{ source: "cotahist", status: "ok", rowCount: 10 }],
        accessLogPurge: { ok: true, deleted: 0 },
        unverifiedAccountPurge: { ok: true, deleted: 0 },
        sessionPurge: { ok: true, deleted: 0 },
        nightlyRunPurge: { ok: true, deleted: 0 },
        evaluation: { signalsWritten: 3, strategiesDeferred: 0, usersSkipped: 0, errorCount: 0 },
        scoring: { decisionsScored: 2, usersSkipped: 0, decisionsSkipped: 0, errorCount: 0 },
      },
    });

    const rows = await db.select().from(nightlyRuns).where(eq(nightlyRuns.startedAt, startedAt));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (!row) throw new Error("expected the recorded row");
    createdIds.push(row.id);
    expect(row.trigger).toBe("manual");
    expect(row.ok).toBe(true);
    expect(row.report).toMatchObject({
      session: "2026-09-08",
      sources: [{ source: "cotahist", status: "ok", rowCount: 10 }],
    });
  });

  it("purges rows older than the retention window and keeps recent ones", async () => {
    const db = getDb();
    const now = new Date("2026-09-28T02:00:00Z");
    const staleId = await insertRawRun(
      new Date(now.getTime() - (NIGHTLY_RUN_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000),
    );
    const freshId = await insertRawRun(
      new Date(now.getTime() - (NIGHTLY_RUN_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000),
    );

    const outcome = await purgeExpiredNightlyRuns(db, now);

    if (!outcome.ok) throw new Error("expected the purge to succeed");
    expect(outcome.deleted).toBeGreaterThanOrEqual(1);
    const remainingStale = await db.select().from(nightlyRuns).where(eq(nightlyRuns.id, staleId));
    const remainingFresh = await db.select().from(nightlyRuns).where(eq(nightlyRuns.id, freshId));
    expect(remainingStale).toEqual([]);
    expect(remainingFresh).toHaveLength(1);
  });

  it("nightly_report_reader can select nightly_runs but is denied on user", async () => {
    const db = getDb();
    await insertRawRun(new Date("2026-09-08T02:00:00Z"));

    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role nightly_report_reader`);

      await expect(tx.execute(sql`select id from nightly_runs limit 1`)).resolves.toBeDefined();

      await expect(tx.execute(sql`select id from "user" limit 1`)).rejects.toSatisfy(
        (error: unknown) => postgresErrorOf(error)?.code === "42501",
      );
    });
  });

  it("nightly_report_reader has SELECT on exactly nightly_runs, no other table in the schema", async () => {
    const db = getDb();
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(tables.rows.map((row) => row.table_name)).toContain("nightly_runs");

    const privileges = await Promise.all(
      tables.rows.map(async (row) => {
        const [privilege] = (
          await db.execute<{ has_select: boolean }>(
            sql`select has_table_privilege('nightly_report_reader', ${row.table_name}, 'SELECT') as has_select`,
          )
        ).rows;
        return { table: row.table_name, hasSelect: privilege?.has_select ?? false };
      }),
    );

    expect(privileges.filter((entry) => entry.hasSelect).map((entry) => entry.table)).toEqual([
      "nightly_runs",
    ]);
  });
});
