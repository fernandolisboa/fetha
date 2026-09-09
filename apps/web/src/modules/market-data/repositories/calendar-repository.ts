import { desc, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tradingSessions } from "@/db/schema/market-data";

import type { ParsedTradingSession } from "../adapters/anbima-calendar/schema";

export async function upsertTradingSessions(
  db: Database,
  rows: ParsedTradingSession[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(tradingSessions)
    .values(
      rows.map((row) => ({
        date: row.date,
        open: new Date(row.open),
        close: new Date(row.close),
      })),
    )
    .onConflictDoUpdate({
      target: tradingSessions.date,
      set: {
        open: sql`excluded.open`,
        close: sql`excluded.close`,
      },
    });

  return rows.length;
}

export async function latestSessionOnOrBefore(
  db: Database,
  at: Date,
): Promise<{ date: string; open: Date; close: Date } | undefined> {
  const [row] = await db
    .select()
    .from(tradingSessions)
    .where(lte(tradingSessions.close, at))
    .orderBy(desc(tradingSessions.date))
    .limit(1);
  return row;
}
