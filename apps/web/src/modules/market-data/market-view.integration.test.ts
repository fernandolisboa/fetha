import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  candles,
  corporateActionFactors,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/db/schema/market-data";

import { buildOperationMarketView } from "./market-view";
import { ensureMonthlyPartition } from "./repositories/partitions";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "20:00:00.000Z";

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

const seededSessionDates: string[] = [];

async function seedSessions(dates: string[]): Promise<void> {
  const db = getDb();
  seededSessionDates.push(...dates);
  await db
    .insert(tradingSessions)
    .values(
      dates.map((date) => ({
        date,
        open: new Date(`${date}T${SESSION_OPEN_UTC}`),
        close: new Date(`${date}T${SESSION_CLOSE_UTC}`),
      })),
    )
    .onConflictDoNothing();
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

describe("buildOperationMarketView", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(candles).where(eq(candles.ticker, ticker));
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, [`${ticker}W1`]));
      await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, ticker));
    }
    const dates = seededSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
  });

  it("includes every session from `at` through the furthest expiry in the chain, with no gap", async () => {
    const underlying = uniqueTicker("FUT");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-03-02", 25);
    const atSession = sessions[0];
    const expiry = sessions[sessions.length - 1];
    if (!atSession || !expiry) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const asOf = new Date(`${atSession}T12:00:00.000Z`);
    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-FUT`,
      ticker: `${underlying}W1`,
      underlying,
      right: "call",
      strike: "12.00000000",
      expiry,
      style: "european",
      asOf,
    });

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    const dates = view.calendar.map((session) => session.date);
    expect(dates).toContain(atSession);
    expect(dates).toContain(expiry);
    for (let index = 1; index < sessions.length; index += 1) {
      expect(dates).toContain(sessions[index]);
    }
  });

  it("includes the current session before its own close", async () => {
    const underlying = uniqueTicker("TOD");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-04-06", 3);
    const atSession = sessions[1];
    if (!atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    expect(view.calendar.map((session) => session.date)).toContain(atSession);
  });

  it("prices a reused ticker from its current listing cycle, not a previous one", async () => {
    const underlying = uniqueTicker("RE1");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}W1`;

    const sessions = businessDays("2099-05-04", 5);
    const atSession = sessions[sessions.length - 1];
    if (!atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const oldExpiry = "2098-08-21";
    const newExpiry = sessions[2];
    const newSession = sessions[1];
    const firstSession = sessions[0];
    if (!newExpiry || !newSession || !firstSession) throw new Error("fixture setup failed");

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${underlying}-OLD`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: oldExpiry,
        style: "european",
        asOf: new Date("2098-06-01T13:00:00.000Z"),
      },
      {
        isin: `ISIN-${underlying}-NEW`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "20.00000000",
        expiry: newExpiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
    ]);

    await ensureMonthlyPartition(db, "option_daily_prices", "2098-08-20");
    await ensureMonthlyPartition(db, "option_daily_prices", newSession);
    await db.insert(optionDailyPrices).values([
      {
        ticker: optionTicker,
        session: "2098-08-20",
        asOf: new Date("2098-08-20T20:00:00.000Z"),
        right: "call",
        strike: "10.00000000",
        expiry: oldExpiry,
        average: "0.500000",
        close: "0.500000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: optionTicker,
        session: newSession,
        asOf: new Date(`${newSession}T20:00:00.000Z`),
        right: "call",
        strike: "20.00000000",
        expiry: newExpiry,
        average: "3.500000",
        close: "3.500000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    const pricesForTicker = view.optionPrices.filter((price) => price.ticker === optionTicker);
    expect(pricesForTicker).toHaveLength(1);
    expect(pricesForTicker[0]?.close).toBe("3.500000");
  });

  it("hides a series not yet visible as of `at`", async () => {
    const underlying = uniqueTicker("VIS");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}W1`;

    const sessions = businessDays("2099-06-01", 3);
    const atSession = sessions[0];
    if (!atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-FUT-PUBLISH`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "15.00000000",
      expiry: sessions[sessions.length - 1] ?? atSession,
      style: "european",
      asOf: new Date(`${atSession}T21:00:00.000Z`),
    });

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    expect(view.optionSeries.some((series) => series.ticker === optionTicker)).toBe(false);
  });

  it("passes corporate action factors for the underlying through unchanged", async () => {
    const underlying = uniqueTicker("CAF");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-07-06", 3);
    const atSession = sessions[1];
    const exDateSession = sessions[0];
    if (!atSession || !exDateSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(corporateActionFactors).values({
      ticker: underlying,
      exDate: exDateSession,
      asOf: new Date(`${exDateSession}T13:00:00.000Z`),
      factor: "0.50000000",
    });

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    expect(view.corporateActions).toEqual([
      {
        ticker: underlying,
        exDate: exDateSession,
        asOf: `${exDateSession}T13:00:00.000Z`,
        factor: "0.50000000",
      },
    ]);
  });
});
