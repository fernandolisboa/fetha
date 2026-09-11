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

// Every macro point (any series) with date in [fromDate, toDate], ordered:
// `validateViewIntegrity` (packages/engine/src/internal/validate-view-integrity.ts)
// covers `calendar`, `candles` and `optionPrices` only — `view.macro` is
// never checked for an exact-tie duplicate, so `resolveRiskFreeRate` (rates.ts)
// breaks a tie on the same `asOf` by array order, and CDI ties are real at
// year end (24/12 and 23/12 both resolve against 26/12's open). Ordering the
// query itself is what keeps that array order deterministic across two
// chunks of the same immutable run (#18 round 5 item 7); an unordered
// result set has no such guarantee even for an identical query re-run
// against unchanged data.
export async function macroPointsInRange(
  db: Database,
  fromDate: string,
  toDate: string,
): Promise<Array<{ series: string; date: string; asOf: Date; annualRate: string }>> {
  return db
    .select()
    .from(macroPoints)
    .where(and(gte(macroPoints.date, fromDate), lte(macroPoints.date, toDate)))
    .orderBy(asc(macroPoints.date), asc(macroPoints.series));
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
