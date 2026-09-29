import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { candles, impliedVolatilityIndexPoints, optionDailyPrices, optionSeries } from "../schema";
import { DAILY_TIMEFRAME } from "./candle-repository";

const CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    await db
      .insert(impliedVolatilityIndexPoints)
      .values(
        batch.map((row) => ({
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
        },
      });
  }

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

// Every underlying with both an option chain that traded on `session`
// (`option_daily_prices`, joined to `option_series` for its `underlying`)
// and its own stock candle on that same session (docs/adr/0054): the IV
// index needs a spot to solve for volatility, so an underlying with only
// one of the two has nothing this compute step can produce a point from.
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
