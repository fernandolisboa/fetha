import { and, eq, gte, inArray, lte, max, min, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type SessionDate,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { DetectedCashDistribution, StrikeTransition } from "../cash-distribution-detection";
import type { CashDistribution } from "../dividend-yield";
import {
  cashDistributions,
  corporateActionFactors,
  optionDailyPrices,
  optionSeries,
} from "../schema";

const previousDay = alias(optionDailyPrices, "previous_day");

// Every physically settled series COTAHIST lists on both `previousSession` and `session`
// under a different strike, with the underlying the instruments registry gives it
// (docs/adr/0070). Index options are cash-settled in points and never adjusted for a
// distribution.
export async function strikeTransitionsBetween(
  db: Database,
  previousSession: string,
  session: string,
): Promise<StrikeTransition[]> {
  const rows = await db
    .selectDistinct({
      ticker: optionDailyPrices.ticker,
      underlying: optionSeries.underlying,
      previousStrike: previousDay.strike,
      strike: optionDailyPrices.strike,
    })
    .from(optionDailyPrices)
    .innerJoin(
      previousDay,
      and(
        eq(previousDay.ticker, optionDailyPrices.ticker),
        eq(previousDay.expiry, optionDailyPrices.expiry),
        eq(previousDay.right, optionDailyPrices.right),
        eq(previousDay.session, previousSession),
      ),
    )
    .innerJoin(
      optionSeries,
      and(
        eq(optionSeries.ticker, optionDailyPrices.ticker),
        eq(optionSeries.expiry, optionDailyPrices.expiry),
        eq(optionSeries.right, optionDailyPrices.right),
      ),
    )
    .where(
      and(
        eq(optionDailyPrices.session, session),
        ne(previousDay.strike, optionDailyPrices.strike),
        eq(optionSeries.settlementStyle, "physical"),
      ),
    );

  return rows.map((row) => ({
    underlying: tickerSchema.parse(row.underlying),
    previousStrike: decimalStringSchema.parse(row.previousStrike),
    strike: decimalStringSchema.parse(row.strike),
  }));
}

// A distribution on the same session as a recorded split or bonus moves strikes by both at
// once, so no uniform drop can be read off it; a neutralized `1` factor is no event.
export async function factorTickersExDated(db: Database, session: string): Promise<string[]> {
  const rows = await db
    .select({ ticker: corporateActionFactors.ticker })
    .from(corporateActionFactors)
    .where(and(eq(corporateActionFactors.exDate, session), ne(corporateActionFactors.factor, "1")));
  return rows.map((row) => row.ticker);
}

// `detected_at` moves only when the stored distribution does, so re-detecting a session leaves
// `MarketView.dataVersion` alone (the same guard as `upsertCorporateActionFactor`).
export async function upsertCashDistributions(
  db: Database,
  exDate: string,
  asOf: Date,
  detected: readonly DetectedCashDistribution[],
): Promise<number> {
  if (detected.length === 0) {
    return 0;
  }
  await db
    .insert(cashDistributions)
    .values(
      detected.map((distribution) => ({
        underlying: distribution.underlying,
        exDate,
        asOf,
        amount: distribution.amount,
        seriesCount: distribution.seriesCount,
      })),
    )
    .onConflictDoUpdate({
      target: [cashDistributions.underlying, cashDistributions.exDate],
      set: {
        asOf: sql`excluded.as_of`,
        amount: sql`excluded.amount`,
        seriesCount: sql`excluded.series_count`,
        detectedAt: sql`now()`,
      },
      setWhere: sql`${cashDistributions.amount} <> excluded.amount or ${cashDistributions.asOf} <> excluded.as_of`,
    });
  return detected.length;
}

export interface DistributionHistory {
  firstExDate: SessionDate;
  lastDetectedAt: Date;
}

// Per underlying, over every distribution ex-dated up to `throughExDate`: the first ex-date
// ever detected and the latest write among them, so a distribution detected late for a past
// ex-date moves a view's `dataVersion` even when it falls before the view's own range.
export async function distributionHistories(
  db: Database,
  underlyings: readonly string[],
  throughExDate: string,
): Promise<Map<string, DistributionHistory>> {
  if (underlyings.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      underlying: cashDistributions.underlying,
      firstExDate: min(cashDistributions.exDate),
      lastDetectedAt: max(cashDistributions.detectedAt),
    })
    .from(cashDistributions)
    .where(
      and(
        inArray(cashDistributions.underlying, [...underlyings]),
        lte(cashDistributions.exDate, throughExDate),
      ),
    )
    .groupBy(cashDistributions.underlying);
  const histories = new Map<string, DistributionHistory>();
  for (const row of rows) {
    if (row.firstExDate === null || row.lastDetectedAt === null) continue;
    histories.set(row.underlying, {
      firstExDate: sessionDateSchema.parse(row.firstExDate),
      lastDetectedAt: row.lastDetectedAt,
    });
  }
  return histories;
}

export async function cashDistributionsInRange(
  db: Database,
  underlyings: readonly string[],
  fromExDate: string,
  toExDate: string,
): Promise<CashDistribution[]> {
  if (underlyings.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(cashDistributions)
    .where(
      and(
        inArray(cashDistributions.underlying, [...underlyings]),
        gte(cashDistributions.exDate, fromExDate),
        lte(cashDistributions.exDate, toExDate),
      ),
    )
    .orderBy(cashDistributions.underlying, cashDistributions.exDate);
  return rows.map((row) => ({
    underlying: tickerSchema.parse(row.underlying),
    exDate: sessionDateSchema.parse(row.exDate),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    amount: decimalStringSchema.parse(row.amount),
  }));
}
