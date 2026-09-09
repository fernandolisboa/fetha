import { desc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { macroPoints } from "@/db/schema/market-data";

import type { MacroPoint, MacroSeriesKind } from "../adapters/bacen-sgs/schema";

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

export async function upsertMacroPoints(db: Database, rows: MacroPoint[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(macroPoints)
    .values(
      rows.map((row) => ({
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

  return rows.length;
}
