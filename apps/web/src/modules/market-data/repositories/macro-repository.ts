import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { macroPoints } from "../schema";

import type { MacroPoint, MacroSeriesKind } from "../adapters/bacen-sgs/schema";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return [...byKey.values()];
}

export async function latestMacroPointDate(
  db: Database,
  series: MacroSeriesKind,
): Promise<string | undefined> {
  const [row] = await db
    .select({ date: macroPoints.date })
    .from(macroPoints)
    .where(eq(macroPoints.series, series))
    .orderBy(desc(macroPoints.date))
    .limit(1);
  return row?.date;
}

// Every macro point (any series) with date in [fromDate, toDate], ordered —
// and the direction of that order is load-bearing, not cosmetic (#18 round
// 6 item 5, corrected in round 7 item 1). The premise round 6 stated here
// was wrong: an exact `(series, asOf)` collision is never tie-broken by
// `resolveRiskFreeRate`'s `latestVisible` at all — `evaluateStrategy`
// (packages/engine/src/internal/evaluate-strategy.ts) runs
// `sortUnique(view.macro, ...)` and returns `invalid_input` on any such
// collision *before* `latestVisible` ever sees `view.macro`, failing the
// whole session's evaluation. CDI ties are real at year end (23/12 and
// 24/12 both stamped at 26/12's own open) and IPCA ties are real whenever
// a whole month's worth of daily rows all resolve to the same
// once-a-month-publication `asOf` (`resolveAsOfInstant`,
// bacen-sgs/parser.ts) — both collide on `(series, asOf)`, and the engine
// rejects the collision outright. `market-view.ts`'s `loadMarketView` is
// the one that must resolve this before the engine ever sees it, by
// keeping only the first row per `(series, asOf)` it encounters; ordering
// `date DESC` here is what makes "first seen" mean "the fresher
// observation wins" rather than an arbitrary one. Ordering the query
// itself also keeps that array order deterministic across two chunks of
// the same immutable run (round 5 item 7); an unordered result set has no
// such guarantee even for an identical query re-run against unchanged
// data.
export async function macroPointsInRange(
  db: Database,
  fromDate: string,
  toDate: string,
): Promise<Array<{ series: string; date: string; asOf: Date; annualRate: string }>> {
  return db
    .select()
    .from(macroPoints)
    .where(and(gte(macroPoints.date, fromDate), lte(macroPoints.date, toDate)))
    .orderBy(desc(macroPoints.date), asc(macroPoints.series));
}

export async function upsertMacroPoints(db: Database, rows: MacroPoint[]): Promise<number> {
  const deduped = dedupeByKey(rows, (row) => `${row.series}:${row.date}`);
  if (deduped.length === 0) {
    return 0;
  }

  for (const batch of chunk(deduped, CHUNK_SIZE)) {
    await db
      .insert(macroPoints)
      .values(
        batch.map((row) => ({
          series: row.series,
          date: row.date,
          asOf: new Date(row.asOf),
          annualRate: row.annualRate,
        })),
      )
      .onConflictDoUpdate({
        target: [macroPoints.series, macroPoints.date],
        set: {
          asOf: sql`excluded.as_of`,
          annualRate: sql`excluded.annual_rate`,
        },
      });
  }

  return deduped.length;
}
