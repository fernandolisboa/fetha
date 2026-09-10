import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getDb } from "@/db/client";
import {
  candles,
  corporateActionFactors,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/db/schema/market-data";

import { cotahistStockRowSchema } from "./adapters/cotahist/schema";
import { buildOperationMarketView, loadMarketView } from "./market-view";
import { upsertDailyCandles } from "./repositories/candle-repository";
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

  it("resolves an exact (ticker, asOf) tie by the engine's tie-break order (strike, then expiry, then right, then ticker; PR #76 round 2 item 2)", async () => {
    const underlying = uniqueTicker("TIE");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}W1`;

    const sessions = businessDays("2099-08-03", 5);
    const atSession = sessions[sessions.length - 1];
    const expiry = sessions[2];
    const tieAsOfSession = sessions[0];
    if (!atSession || !expiry || !tieAsOfSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const tieAsOf = new Date(`${tieAsOfSession}T13:00:00.000Z`);
    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${underlying}-HIGH`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "20.00000000",
        expiry,
        style: "european",
        asOf: tieAsOf,
      },
      {
        isin: `ISIN-${underlying}-LOW`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: tieAsOf,
      },
    ]);

    const sessionForHighPrice = sessions[1];
    const sessionForLowPrice = sessions[3];
    if (!sessionForHighPrice || !sessionForLowPrice) throw new Error("fixture setup failed");
    await ensureMonthlyPartition(db, "option_daily_prices", sessionForHighPrice);
    await ensureMonthlyPartition(db, "option_daily_prices", sessionForLowPrice);
    await db.insert(optionDailyPrices).values([
      {
        ticker: optionTicker,
        session: sessionForHighPrice,
        asOf: new Date(`${sessionForHighPrice}T20:00:00.000Z`),
        right: "call",
        strike: "20.00000000",
        expiry,
        average: "5.000000",
        close: "5.000000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: optionTicker,
        session: sessionForLowPrice,
        asOf: new Date(`${sessionForLowPrice}T20:00:00.000Z`),
        right: "call",
        strike: "10.00000000",
        expiry,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    const prices = view.optionPrices.filter((price) => price.ticker === optionTicker);
    expect(prices).toHaveLength(1);
    expect(prices[0]?.close).toBe("1.000000");
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

  it("excludes a series that expired long before the calendar window instead of accumulating every ticker ever listed (PR #76 round 2 item 5)", async () => {
    const underlying = uniqueTicker("OLD");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-09-01", 40);
    const atSession = sessions[sessions.length - 1];
    if (!atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const longExpiredTicker = `${underlying}OLD1`;
    const currentTicker = `${underlying}NEW1`;
    const longExpiredExpiry = sessions[1];
    const currentExpiry = sessions[sessions.length - 2];
    const firstSession = sessions[0];
    if (!longExpiredExpiry || !currentExpiry || !firstSession) {
      throw new Error("fixture setup failed");
    }

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${underlying}-LONG-GONE`,
        ticker: longExpiredTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: longExpiredExpiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
      {
        isin: `ISIN-${underlying}-CURRENT`,
        ticker: currentTicker,
        underlying,
        right: "call",
        strike: "12.00000000",
        expiry: currentExpiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
    ]);

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    expect(view.optionSeries.some((series) => series.ticker === longExpiredTicker)).toBe(false);
    expect(view.optionSeries.some((series) => series.ticker === currentTicker)).toBe(true);
  });

  it("does not pull an option's only price row from long before the calendar window (PR #76 round 2 item 5)", async () => {
    const underlying = uniqueTicker("OLP");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}A100`;

    const sessions = businessDays("2099-10-01", 40);
    const atSession = sessions[sessions.length - 1];
    if (!atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const expiry = sessions[sessions.length - 2];
    const veryOldSession = sessions[0];
    if (!expiry || !veryOldSession) throw new Error("fixture setup failed");

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-CUR`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${veryOldSession}T13:00:00.000Z`),
    });

    await ensureMonthlyPartition(db, "option_daily_prices", veryOldSession);
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

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    const prices = view.optionPrices.filter((price) => price.ticker === optionTicker);
    expect(prices).toHaveLength(0);
  });

  it("surfaces the underlying's own candle close, stored under the repository's daily timeframe rather than the engine's own 'D1' label (PR #76 round 3)", async () => {
    const underlying = uniqueTicker("SPT");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-11-02", 5);
    const candleSession = sessions[0];
    const atSession = sessions[4];
    if (!candleSession || !atSession) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await upsertDailyCandles(db, candleSession, new Date(`${candleSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: candleSession,
        ticker: underlying,
        open: "30.000000",
        high: "30.500000",
        low: "29.500000",
        average: "30.000000",
        close: "30.000000",
        trades: 100,
        tradedQuantity: 10000,
      }),
    ]);

    const at = `${atSession}T14:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at);

    expect(view.candles).toHaveLength(1);
    expect(view.candles[0]?.close).toBe("30.000000");
  });

  it("fails typed instead of reaching the engine when a stored option right is out of vocabulary (round 2 item 2)", async () => {
    const underlying = uniqueTicker("BAD");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-12-01", 3);
    const atSession = sessions[0];
    const expiry = sessions[sessions.length - 1];
    if (!atSession || !expiry) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${underlying}-BAD`,
      ticker: `${underlying}W1`,
      underlying,
      right: "straddle",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${atSession}T13:00:00.000Z`),
    });

    const at = `${atSession}T14:00:00.000Z`;
    await expect(buildOperationMarketView(db, underlying, at)).rejects.toThrow(ZodError);
  });
});

describe("loadMarketView", () => {
  const cleanupSeries: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const dates = seededSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
    const series = cleanupSeries.splice(0);
    if (series.length > 0) {
      await db.delete(macroPoints).where(inArray(macroPoints.series, series));
    }
  });

  it("fails typed instead of reaching the engine when a stored macro series is out of vocabulary (round 2 item 2)", async () => {
    const db = getDb();
    const sessions = businessDays("2099-12-08", 3);
    const from = sessions[0];
    const to = sessions[sessions.length - 1];
    if (!from || !to) throw new Error("fixture setup failed");
    await seedSessions(sessions);

    const bogusSeries = `bogus-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    cleanupSeries.push(bogusSeries);
    await db.insert(macroPoints).values({
      series: bogusSeries,
      date: from,
      asOf: new Date(`${from}T13:00:00.000Z`),
      annualRate: "10.00000000",
    });

    await expect(
      loadMarketView(db, {
        from: `${from}T00:00:00.000Z`,
        to: `${to}T23:59:59.000Z`,
        instruments: [],
        timeframes: ["D1"],
        collections: ["macro"],
      }),
    ).rejects.toThrow(ZodError);
  });
});
