import { and, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database, Transaction } from "@/db/client";
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
        stale: false,
      },
    });

  return rows.length;
}

export async function deleteStaleIvIndexPoints(
  db: Database,
  session: string,
  underlyings: readonly string[],
): Promise<void> {
  if (underlyings.length === 0) {
    return;
  }
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(
      and(
        eq(impliedVolatilityIndexPoints.session, session),
        inArray(impliedVolatilityIndexPoints.underlying, [...underlyings]),
        eq(impliedVolatilityIndexPoints.stale, true),
      ),
    );
}

export async function markIvIndexPointsStale(
  db: Database | Transaction,
  underlying: string,
): Promise<void> {
  await db
    .update(impliedVolatilityIndexPoints)
    .set({ stale: true })
    .where(eq(impliedVolatilityIndexPoints.underlying, underlying));
}

export async function sessionsWithStaleIvIndexPoints(db: Database): Promise<string[]> {
  const rows = await db
    .selectDistinct({ session: impliedVolatilityIndexPoints.session })
    .from(impliedVolatilityIndexPoints)
    .where(eq(impliedVolatilityIndexPoints.stale, true));
  return rows.map((row) => row.session);
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
    .where(eq(optionDailyPrices.session, session))
    .orderBy(optionSeries.underlying);

  return rows.map((row) => row.underlying);
}

export async function ivIndexPointStatesOnSession(
  db: Database,
  session: string,
): Promise<{ underlying: string; stale: boolean }[]> {
  return db
    .select({
      underlying: impliedVolatilityIndexPoints.underlying,
      stale: impliedVolatilityIndexPoints.stale,
    })
    .from(impliedVolatilityIndexPoints)
    .where(eq(impliedVolatilityIndexPoints.session, session));
}

// The radar's universe (docs/adr/0066): every underlying with an IV index point on `session`
// whose options traded (`trades > 0` on any series) on at least `minTradedSessions` of the
// sessions from `fromSession` through `session`.
export async function liquidOptionableUnderlyings(
  db: Database,
  session: string,
  fromSession: string,
  minTradedSessions: number,
): Promise<string[]> {
  const tradedSessions = sql<number>`count(distinct ${optionDailyPrices.session})`;
  const rows = await db
    .select({ underlying: optionSeries.underlying })
    .from(optionDailyPrices)
    .innerJoin(optionSeries, eq(optionSeries.ticker, optionDailyPrices.ticker))
    .innerJoin(
      impliedVolatilityIndexPoints,
      and(
        eq(impliedVolatilityIndexPoints.underlying, optionSeries.underlying),
        eq(impliedVolatilityIndexPoints.session, session),
      ),
    )
    .where(
      and(
        gte(optionDailyPrices.session, fromSession),
        lte(optionDailyPrices.session, session),
        gt(optionDailyPrices.trades, 0),
      ),
    )
    .groupBy(optionSeries.underlying)
    .having(gte(tradedSessions, minTradedSessions))
    .orderBy(optionSeries.underlying);

  return rows.map((row) => row.underlying);
}
