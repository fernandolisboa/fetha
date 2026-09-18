import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { optionDailyPrices, optionSeries, tradingSessions } from "../schema";

import { ensureMonthlyPartition } from "./partitions";
import { optionChainForUnderlying } from "./option-repository";

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

const pricedTickers: string[] = [];

describe("optionChainForUnderlying", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
    }
    const priced = pricedTickers.splice(0);
    if (priced.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, priced));
    }
    const dates = seededSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
  });

  it("excludes a series whose expiry has already passed", async () => {
    const underlying = uniqueTicker("EXP");
    cleanupTickers.push(underlying);
    const db = getDb();
    const sessions = businessDays("2099-01-05", 5);
    const currentSession = sessions[sessions.length - 1];
    const expiredExpiry = sessions[0];
    if (!currentSession || !expiredExpiry) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-EXPIRED`,
      ticker: `${underlying}A100`,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry: expiredExpiry,
      style: "european",
      asOf: new Date(`${expiredExpiry}T13:00:00.000Z`),
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    expect(chain).toHaveLength(0);
  });

  it("excludes a series that is not yet visible as of `at`", async () => {
    const underlying = uniqueTicker("VIS");
    cleanupTickers.push(underlying);
    const db = getDb();
    const sessions = businessDays("2099-02-02", 5);
    const currentSession = sessions[0];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !expiry) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-FUTURE-PUBLISH`,
      ticker: `${underlying}A100`,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${currentSession}T21:00:00.000Z`),
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    expect(chain).toHaveLength(0);
  });

  it("returns one row per ticker reused across listing cycles", async () => {
    const underlying = uniqueTicker("REU");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}A100`;
    const sessions = businessDays("2099-03-02", 6);
    const currentSession = sessions[0];
    const newExpiry = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    if (!currentSession || !newExpiry || !firstSession) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${underlying}-OLD`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: "2098-08-21",
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

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const matches = chain.filter((series) => series.ticker === optionTicker);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.strike).toBe("20.00000000");
  });

  it("excludes a series expiring today once today's session has closed (PR #76 round 2 item 8)", async () => {
    const underlying = uniqueTicker("TOD");
    cleanupTickers.push(underlying);
    const db = getDb();
    const sessions = businessDays("2099-04-06", 3);
    const currentSession = sessions[1];
    const firstSession = sessions[0];
    if (!currentSession || !firstSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-EXPTODAY`,
      ticker: `${underlying}A100`,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry: currentSession,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });

    const beforeClose = new Date(`${currentSession}T18:00:00.000Z`);
    const afterClose = new Date(`${currentSession}T21:00:00.000Z`);

    const chainBeforeClose = await optionChainForUnderlying(
      db,
      underlying,
      currentSession,
      beforeClose,
    );
    expect(chainBeforeClose).toHaveLength(1);

    const chainAfterClose = await optionChainForUnderlying(
      db,
      underlying,
      currentSession,
      afterClose,
    );
    expect(chainAfterClose).toHaveLength(0);
  });

  it("carries a traded series' latest visible price and session", async () => {
    const underlying = uniqueTicker("TRD");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}A100`;
    const sessions = businessDays("2099-05-04", 5);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const tradedSession = sessions[1];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !tradedSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-TRADED`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });

    await ensureMonthlyPartition(db, "option_daily_prices", tradedSession);
    pricedTickers.push(optionTicker);
    await db.insert(optionDailyPrices).values({
      ticker: optionTicker,
      session: tradedSession,
      asOf: new Date(`${tradedSession}T20:00:00.000Z`),
      right: "call",
      strike: "10.00000000",
      expiry,
      average: "1.500000",
      close: "1.550000",
      trades: 4,
      tradedQuantity: 400,
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.lastPrice).toEqual({ value: "1.550000", session: tradedSession });
  });

  it("reports a listed but untraded series with no price", async () => {
    const underlying = uniqueTicker("UNT");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}A100`;
    const sessions = businessDays("2099-06-01", 5);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-UNTRADED`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.lastPrice).toBeNull();
  });

  it("does not use a price outside the calendar window", async () => {
    const underlying = uniqueTicker("OWN");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}A100`;
    const sessions = businessDays("2099-07-01", 40);
    const currentSession = sessions[sessions.length - 1];
    const veryOldSession = sessions[0];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !veryOldSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-OLDPRICE`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${veryOldSession}T13:00:00.000Z`),
    });

    await ensureMonthlyPartition(db, "option_daily_prices", veryOldSession);
    pricedTickers.push(optionTicker);
    await db.insert(optionDailyPrices).values({
      ticker: optionTicker,
      session: veryOldSession,
      asOf: new Date(`${veryOldSession}T20:00:00.000Z`),
      right: "call",
      strike: "10.00000000",
      expiry,
      average: "9.000000",
      close: "9.000000",
      trades: 1,
      tradedQuantity: 100,
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.lastPrice).toBeNull();
  });
});
