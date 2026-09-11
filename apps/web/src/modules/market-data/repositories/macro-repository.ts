import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { macroPoints } from "@/db/schema/market-data";

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
// 6 item 5). `validateViewIntegrity`
// (packages/engine/src/internal/validate-view-integrity.ts) covers
// `calendar`, `candles` and `optionPrices` only — `view.macro` is never
// checked for an exact-tie duplicate, so `resolveRiskFreeRate` (rates.ts)
// resolves a same-`asOf` tie through `latestVisible`'s strict `>` compare,
// which keeps the *first* row it sees and never replaces it on an equal
// `asOf`. CDI ties are real at year end: 23/12 and 24/12 both publish their
// rate stamped at 26/12's open (the next session's own `asOf`), so both are
// visible at the same instant. This deliberately orders `date DESC`, so the
// fresher point (24/12) is seen first and wins the tie — the more recent
// observation is the more accurate one, and the alternative (the older
// point winning) would mean a later, presumably-corrected or more current
// rate is silently discarded in favour of a stale one whenever both are
// stamped together. Ordering the query itself also keeps that array order
// deterministic across two chunks of the same immutable run (round 5 item
// 7); an unordered result set has no such guarantee even for an identical
// query re-run against unchanged data.
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
