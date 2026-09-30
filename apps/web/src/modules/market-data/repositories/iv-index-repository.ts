import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles, impliedVolatilityIndexPoints, optionDailyPrices, optionSeries } from "../schema";
import { DAILY_TIMEFRAME } from "./candle-repository";

export interface IvIndexPointRow {
  underlying: string;
  session: string;
  asOf: Date;
  impliedVolatility: string;
  method: string;
}

export async function upsertIvIndexPoints(db: Database, rows: IvIndexPointRow[]): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(impliedVolatilityIndexPoints)
    .values(
      rows.map((row) => ({
        underlying: row.underlying,
        session: row.session,
        asOf: row.asOf,
        impliedVolatility: row.impliedVolatility,
        method: row.method,
      })),
    )
    .onConflictDoUpdate({
      target: [impliedVolatilityIndexPoints.underlying, impliedVolatilityIndexPoints.session],
      set: {
        asOf: sql`excluded.as_of`,
        impliedVolatility: sql`excluded.implied_volatility`,
        method: sql`excluded.method`,
        computedAt: sql`now()`,
      },
    });

  return rows.length;
}

export async function ivIndexPointsInRange(
  db: Database,
  underlyings: readonly string[],
  fromSession: string,
  toSession: string,
): Promise<(typeof impliedVolatilityIndexPoints.$inferSelect)[]> {
  if (underlyings.length === 0) {
    return [];
  }
  return db
    .select()
    .from(impliedVolatilityIndexPoints)
    .where(
      and(
        inArray(impliedVolatilityIndexPoints.underlying, [...underlyings]),
        gte(impliedVolatilityIndexPoints.session, fromSession),
        lte(impliedVolatilityIndexPoints.session, toSession),
      ),
    );
}

export async function underlyingsToComputeForSession(
  db: Database,
  session: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ underlying: optionSeries.underlying })
    .from(optionDailyPrices)
    .innerJoin(optionSeries, eq(optionSeries.ticker, optionDailyPrices.ticker))
    .innerJoin(
      candles,
      and(
        eq(candles.ticker, optionSeries.underlying),
        eq(candles.timeframe, DAILY_TIMEFRAME),
        eq(candles.session, session),
      ),
    )
    .where(eq(optionDailyPrices.session, session));

  return rows.map((row) => row.underlying);
}

export async function underlyingsWithPointOnSession(
  db: Database,
  session: string,
): Promise<string[]> {
  const rows = await db
    .select({ underlying: impliedVolatilityIndexPoints.underlying })
    .from(impliedVolatilityIndexPoints)
    .where(eq(impliedVolatilityIndexPoints.session, session));

  return rows.map((row) => row.underlying);
}
