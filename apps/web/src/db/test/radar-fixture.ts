import { inArray } from "drizzle-orm";
import { decimalStringSchema, type Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  impliedVolatilityIndexPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";
import { radarReadings } from "@/modules/radar/schema";

function businessDays(startIso: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// A far-future range of its own (2095–2099), so no other fixture's sessions interleave with
// the liquidity window the universe counts over.
export const SESSIONS = businessDays(`${String(2095 + Math.floor(Math.random() * 5))}-02-01`, 140);
export const SCAN_INDEX = 90;
export const SCAN_SESSION = SESSIONS[SCAN_INDEX] ?? "";
export const EXPIRY_INDEX = 125;
const FIRST_PRICED_INDEX = 55;
const STRIKE_STEP = 0.25;

export type Scenario = {
  ticker: Ticker;
  close: (index: number) => number;
  iv: (index: number) => number;
  optionsTradeOn: (index: number) => boolean;
  ivPointOn: (index: number) => boolean;
};

const optionTickers: string[] = [];
const insertedSessions: string[] = [];
let seededUnderlyings: Ticker[] = [];

function money(value: number): string {
  return value.toFixed(2);
}

export function closeOf(scenario: Scenario, index: number): string {
  return money(scenario.close(index));
}

function strikes(scenario: Scenario): number[] {
  const closes = SESSIONS.map((_session, index) => scenario.close(index)).slice(
    FIRST_PRICED_INDEX,
    SCAN_INDEX + 1,
  );
  const low = Math.floor((Math.min(...closes) * 0.85) / STRIKE_STEP) * STRIKE_STEP;
  const high = Math.ceil((Math.max(...closes) * 1.15) / STRIKE_STEP) * STRIKE_STEP;
  const result: number[] = [];
  for (let strike = low; strike <= high + 1e-9; strike += STRIKE_STEP) {
    result.push(Math.round(strike * 100) / 100);
  }
  return result;
}

// COTAHIST-shaped candles go through ingestion's candle writer and options are inserted directly:
// the recorded COTAHIST sample holds one session, and a recipe's entry reads 84 sessions of history.
async function seedScenario(scenario: Scenario): Promise<void> {
  const db = getDb();
  for (const [index, session] of SESSIONS.entries()) {
    const close = decimalStringSchema.parse(closeOf(scenario, index));
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      {
        kind: "stock",
        session,
        ticker: scenario.ticker,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      },
    ]);
  }
  await db.insert(impliedVolatilityIndexPoints).values(
    SESSIONS.flatMap((session, index) =>
      scenario.ivPointOn(index)
        ? [
            {
              underlying: scenario.ticker,
              session,
              asOf: new Date(`${session}T20:00:00.000Z`),
              impliedVolatility: scenario.iv(index).toFixed(4),
              method: "atm_30d_variance_interpolated" as const,
            },
          ]
        : [],
    ),
  );

  const series = strikes(scenario).flatMap((strike, ordinal) =>
    (["call", "put"] as const).map((right) => ({
      ticker: `${scenario.ticker.slice(0, 6)}${right === "call" ? "C" : "P"}${String(ordinal).padStart(3, "0")}`,
      right,
      strike,
    })),
  );
  optionTickers.push(...series.map((entry) => entry.ticker));
  const expiry = SESSIONS[EXPIRY_INDEX] ?? "";
  await db.insert(optionSeries).values(
    series.map((entry) => ({
      isin: `ISIN-${entry.ticker}`,
      ticker: entry.ticker,
      underlying: scenario.ticker,
      right: entry.right,
      strike: money(entry.strike),
      expiry,
      style: "european" as const,
      asOf: new Date(`${SESSIONS[0] ?? ""}T13:00:00.000Z`),
    })),
  );

  const prices = series.flatMap((entry) =>
    SESSIONS.slice(FIRST_PRICED_INDEX, EXPIRY_INDEX + 1).map((session, offset) => {
      const index = FIRST_PRICED_INDEX + offset;
      const spot = scenario.close(index);
      const intrinsic =
        entry.right === "call"
          ? Math.max(spot - entry.strike, 0)
          : Math.max(entry.strike - spot, 0);
      const price = money(
        Math.max(intrinsic + 0.25 * Math.sqrt((EXPIRY_INDEX - index) / 21), 0.01),
      );
      return {
        ticker: entry.ticker,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        right: entry.right,
        strike: money(entry.strike),
        expiry,
        average: price,
        close: price,
        trades: scenario.optionsTradeOn(index) ? 10 : 0,
        tradedQuantity: scenario.optionsTradeOn(index) ? 1000 : 0,
      };
    }),
  );
  for (let start = 0; start < prices.length; start += 1000) {
    await db.insert(optionDailyPrices).values(prices.slice(start, start + 1000));
  }
}

export async function clearRadar(): Promise<void> {
  await getDb().delete(radarReadings).where(inArray(radarReadings.underlying, seededUnderlyings));
}

export async function seedRadarFixture(scenarios: readonly Scenario[]): Promise<void> {
  const db = getDb();
  seededUnderlyings = scenarios.map((scenario) => scenario.ticker);
  const inserted = await db
    .insert(tradingSessions)
    .values(
      SESSIONS.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing()
    .returning({ date: tradingSessions.date });
  insertedSessions.push(...inserted.map((row) => row.date));
  for (const month of new Set(SESSIONS.map((session) => session.slice(0, 7)))) {
    await ensureMonthlyPartition(db, "option_daily_prices", `${month}-01`);
    await ensureMonthlyPartition(db, "candles", `${month}-01`);
  }
  for (const scenario of scenarios) {
    await seedScenario(scenario);
  }
}

export async function cleanRadarFixture(): Promise<void> {
  const db = getDb();
  await clearRadar();
  await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
  await db.delete(optionSeries).where(inArray(optionSeries.underlying, seededUnderlyings));
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(inArray(impliedVolatilityIndexPoints.underlying, seededUnderlyings));
  await db.delete(candles).where(inArray(candles.ticker, seededUnderlyings));
  if (insertedSessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, insertedSessions));
  }
}
