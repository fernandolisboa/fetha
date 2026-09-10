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

export async function macroPointsBetween(
  db: Database,
  from: string,
  to: string,
): Promise<Array<{ series: string; date: string; asOf: Date; annualRate: string }>> {
  return db
    .select()
    .from(macroPoints)
    .where(and(gte(macroPoints.date, from), lte(macroPoints.date, to)))
    .orderBy(asc(macroPoints.date));
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
