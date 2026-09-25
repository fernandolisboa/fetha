import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { instantSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import type { DecimalString, Structure, StrategyDefinition } from "@fetha/contracts";
import { engine, type StrategyVersion, type TradingSession } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  candles,
  corporateActionFactors,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "./schema";

import { cotahistStockRowSchema } from "./adapters/cotahist/schema";
import {
  buildOperationMarketView,
  calendarUpTo,
  loadMarketView,
  MarketViewTooLargeError,
  MarketViewUnavailableError,
  tradingSessionForDate,
} from "./market-view";
import { DAILY_TIMEFRAME, upsertDailyCandles } from "./repositories/candle-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "20:00:00.000Z";

// A tiny deterministic PRNG (#19 round 3 item 5), not cryptographic: the
// same seed always produces the same sequence, so the EMA truncation
// fixture below is reproducible across runs and machines instead of relying
// on `Math.random()`.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

// Builds the window the same way a real caller does (run-chunk.ts,
// evaluate-signals.ts): resolve `from`/`to` as trading sessions, load the
// calendar up to `to`'s close, hand both to `engine.dataWindow`. Exercising
// `loadMarketView` through this helper, not a hand-built `DataWindow`,
// proves the two real callers and this suite resolve warmup the same way.
async function windowFor(
  strategy: StrategyVersion,
  instruments: string[],
  from: string,
  to: string,
): Promise<ReturnType<typeof engine.dataWindow>> {
  const db = getDb();
  const fromSession = await tradingSessionForDate(db, from);
  const toSession = await tradingSessionForDate(db, to);
  if (!fromSession || !toSession) throw new Error("fixture setup failed: session missing");
  const calendar = await calendarUpTo(db, new Date(toSession.close));
  return engine.dataWindow({
    strategy,
    instruments: instruments.map((ticker) => tickerSchema.parse(ticker)),
    calendar,
    at: toSession.close,
    since: fromSession.open,
  });
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

  it("keeps the 30-session warm-up below a decidedAt-widened floor, not swallowed by a wide decidedAt..at span (round 3 item 7)", async () => {
    const underlying = uniqueTicker("WRM");
    cleanupTickers.push(underlying);
    const db = getDb();

    const sessions = businessDays("2098-01-05", 100);
    await seedSessions(sessions);

    const atSession = sessions[sessions.length - 1];
    // decidedAt session 70 (index 69): the widened range decidedAt..at is 31
    // sessions, itself already past the default 30-session floor.
    const decidedAtSession = sessions[69];
    // Session 45 (index 44): inside the fixed window's own extra 30-session
    // warm-up below the widened floor (sessions 40..100), but strictly
    // before `decidedAtSession` — the pre-fix `Math.max(30, widenedRange.length)`
    // would have dropped it, since the unfixed window only ever reached back
    // to `decidedAtSession` itself (session 70).
    const warmupSession = sessions[44];
    if (!atSession || !decidedAtSession || !warmupSession) {
      throw new Error("fixture setup failed");
    }

    await upsertDailyCandles(db, warmupSession, new Date(`${warmupSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: warmupSession,
        ticker: underlying,
        open: "10.000000",
        high: "10.500000",
        low: "9.500000",
        average: "10.000000",
        close: "10.000000",
        trades: 10,
        tradedQuantity: 1000,
      }),
    ]);

    const at = `${atSession}T14:00:00.000Z`;
    const from = `${decidedAtSession}T13:00:00.000Z`;
    const view = await buildOperationMarketView(db, underlying, at, { from });

    expect(view.calendar.map((session) => session.date)).toContain(warmupSession);
    expect(view.candles.some((candle) => candle.session === warmupSession)).toBe(true);
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

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

function smaDefinition(): StrategyDefinition {
  return {
    name: "SMA(20) crossover",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.2") },
    exit: [],
    adjustments: [],
  };
}

const COVERED_CALL_STRUCTURE: Structure = {
  id: "covered-call",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ],
};

describe("loadMarketView", () => {
  const cleanupTickers: string[] = [];
  const cleanupOptionTickers: string[] = [];
  const cleanupDates: string[] = [];
  const cleanupSeries: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(candles).where(eq(candles.ticker, ticker));
      await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, ticker));
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
    }
    for (const optionTicker of cleanupOptionTickers.splice(0)) {
      await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, optionTicker));
    }
    const dates = cleanupDates.splice(0);
    if (dates.length > 0) {
      await db.delete(macroPoints).where(inArray(macroPoints.date, dates));
    }
    const series = cleanupSeries.splice(0);
    if (series.length > 0) {
      await db.delete(macroPoints).where(inArray(macroPoints.series, series));
    }
    const sessionDates = seededSessionDates.splice(0);
    if (sessionDates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessionDates));
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

  it("returns at least 450 candles for an ema(150) DataWindow over ~500 sessions, close to the full-history indicator value (round 2 item 5)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("EMA");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2020-01-06", 500);
    await seedSessions(sessions);

    const months = new Set(sessions.map((session) => session.slice(0, 7)));
    for (const month of months) {
      await ensureMonthlyPartition(db, "candles", `${month}-01`);
    }

    // A perfect linear ramp is vacuous here (#19 round 3 item 5): an EMA's
    // SMA seed lands exactly on a linear series' fixed point, so the
    // truncated and full-history values come out bit-identical for any
    // window >= 150 bars, no matter how the tolerance is set. A deterministic
    // seeded level shift inside the first 50 bars — priced near R$ 100, so
    // one centavo of rounding is ~0.01%, well under the bound below — gives
    // the truncated EMA(150) something real to differ from: the shift sits
    // outside the >= 450-bar truncated window but inside the full 500-bar
    // history, so their SMA seeds differ and the gap decays but never hits
    // zero.
    const walk = mulberry32(20260910);
    const rows = sessions.map((session, index) => {
      const level = index < 50 ? 85 : 100;
      const noise = (walk() - 0.5) * 0.4;
      const close = (level + noise).toFixed(8);
      return {
        ticker,
        timeframe: DAILY_TIMEFRAME,
        session,
        asOf: new Date(`${session}T${SESSION_CLOSE_UTC}`),
        open: close,
        high: close,
        low: close,
        close,
        tradedQuantity: 1000,
      };
    });
    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) {
      await db
        .insert(candles)
        .values(rows.slice(start, start + batchSize))
        .onConflictDoUpdate({
          target: [candles.ticker, candles.timeframe, candles.session],
          set: {
            asOf: sql`excluded.as_of`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            tradedQuantity: sql`excluded.traded_quantity`,
          },
        });
    }

    const firstSession = sessions[0];
    const lastSession = sessions[sessions.length - 1];
    if (!firstSession || !lastSession) throw new Error("fixture setup failed");

    const calendar: TradingSession[] = sessions.map((session) => ({
      date: sessionDateSchema.parse(session),
      open: instantSchema.parse(`${session}T${SESSION_OPEN_UTC}`),
      close: instantSchema.parse(`${session}T${SESSION_CLOSE_UTC}`),
    }));
    const at = instantSchema.parse(`${lastSession}T${SESSION_CLOSE_UTC}`);

    const structure: Structure = {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    };
    const definition: StrategyDefinition = {
      name: "EMA truncation fixture",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "ema", length: 150 } },
        comparator: ">",
        right: { kind: "price", field: "close" },
      },
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [],
    };
    const strategy: StrategyVersion = { id: "fixture-version", definition, structure };
    const instruments = [tickerSchema.parse(ticker)];

    const truncatedWindow = engine.dataWindow({ strategy, instruments, calendar, at });

    const truncatedView = await loadMarketView(db, truncatedWindow);
    const tickerCandles = truncatedView.candles.filter((c) => c.ticker === ticker);
    expect(tickerCandles.length).toBeGreaterThanOrEqual(450);
    expect(tickerCandles.length).toBeLessThan(500);

    const fullWindow = engine.dataWindow({
      strategy,
      instruments,
      calendar,
      at,
      since: calendar[0]?.close,
    });
    const fullView = await loadMarketView(db, fullWindow);
    expect(fullView.candles.filter((c) => c.ticker === ticker).length).toBe(500);

    const truncatedResult = await engine.indicators({
      view: truncatedView,
      ticker: tickerSchema.parse(ticker),
      timeframe: "D1",
      indicators: [{ kind: "ema", length: 150 }],
      at,
    });
    const fullResult = await engine.indicators({
      view: fullView,
      ticker: tickerSchema.parse(ticker),
      timeframe: "D1",
      indicators: [{ kind: "ema", length: 150 }],
      at,
    });
    if (!truncatedResult.ok || !fullResult.ok) {
      throw new Error("indicator computation failed");
    }

    const truncatedValue = truncatedResult.value.series[0]?.values.at(-1);
    const fullValue = fullResult.value.series[0]?.values.at(-1);
    if (!truncatedValue || !fullValue) {
      throw new Error("missing ema value");
    }
    const relativeDifference =
      Math.abs(Number(truncatedValue) - Number(fullValue)) / Number(fullValue);
    // Non-zero (#19 round 3 item 5): the level shift the truncated window
    // drops makes this assertion actually exercise the tolerance instead of
    // reading zero regardless of how much warm-up the window keeps.
    expect(relativeDifference).toBeGreaterThan(0);
    expect(relativeDifference).toBeLessThan(0.001);
  });

  it("loads warm-up candles before period.from for an SMA(20) strategy, not just the requested period", async () => {
    const db = getDb();
    const ticker = uniqueTicker("SMA");
    cleanupTickers.push(ticker);

    // 40 sessions so an SMA(20) warmup (~20 sessions back) reaches well
    // before `period.from`, the middle of the calendar below.
    const sessions = businessDays("2097-03-04", 40);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const periodFrom = sessions[25] ?? "";
    const periodTo = sessions.at(-1) ?? "";

    const window = await windowFor(strategy, [ticker], periodFrom, periodTo);
    const view = await loadMarketView(db, window);

    const earliestLoadedSession = view.candles.map((c) => c.session).sort()[0];
    expect(earliestLoadedSession).toBeDefined();
    expect((earliestLoadedSession as string) < periodFrom).toBe(true);
  });

  it("populates corporate actions for every ticker in the universe", async () => {
    const db = getDb();
    const ticker = uniqueTicker("CAF");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-04-06", 5);
    await seedSessions(sessions);
    const exDate = sessions[1] ?? "";
    await db.insert(corporateActionFactors).values({
      ticker,
      exDate,
      asOf: new Date(`${exDate}T13:00:00.000Z`),
      factor: "0.50000000",
    });

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    const view = await loadMarketView(db, window);

    expect(view.corporateActions).toEqual([
      { ticker, exDate, asOf: `${exDate}T13:00:00.000Z`, factor: "0.50000000" },
    ]);
  });

  it("populates macro points inside the loaded window", async () => {
    const db = getDb();
    const ticker = uniqueTicker("MAC");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-05-04", 5);
    await seedSessions(sessions);
    const macroDate = sessions[2] ?? "";
    cleanupDates.push(macroDate);
    await db.insert(macroPoints).values({
      series: "cdi",
      date: macroDate,
      asOf: new Date(`${macroDate}T20:00:00.000Z`),
      annualRate: "0.1075",
    });

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    const view = await loadMarketView(db, window);

    expect(view.macro.some((point) => point.date === macroDate && point.series === "cdi")).toBe(
      true,
    );
  });

  it("collapses a colliding (series, asOf) group to its freshest date, so the run the engine would otherwise reject on sight completes (round 7 item 1)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("MTIE");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-12-01", 8);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    // A real CDI year-end collision (round 7 item 1): two distinct
    // observation dates both stamped `asOf` the same next session's own
    // open, exactly the mechanism `resolveAsOfInstant`
    // (bacen-sgs/parser.ts) produces for `nextSessionStrictlyAfter`.
    const staleDate = sessions[0] ?? "";
    const freshDate = sessions[1] ?? "";
    const collisionSession = sessions[2] ?? "";
    const collidingAsOf = new Date(`${collisionSession}T13:00:00.000Z`);
    cleanupDates.push(staleDate, freshDate);
    await db.insert(macroPoints).values([
      { series: "cdi", date: staleDate, asOf: collidingAsOf, annualRate: "0.1050" },
      { series: "cdi", date: freshDate, asOf: collidingAsOf, annualRate: "0.1075" },
    ]);

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    const view = await loadMarketView(db, window);

    const cdiPoints = view.macro.filter((point) => point.series === "cdi");
    expect(cdiPoints).toHaveLength(1);
    expect(cdiPoints[0]?.date).toBe(freshDate);
    expect(cdiPoints[0]?.annualRate).toBe("0.10750000");

    // The engine itself is the actual assertion this test exists for: an
    // uncollapsed view fails here with `invalid_input("view.macro", ...)`
    // before ever pricing anything (evaluate-strategy.ts's own
    // `sortUnique`), which is the failure round 7 item 1 reported as
    // reachable, not theoretical.
    const result = await engine.evaluateStrategy({
      view,
      strategy,
      instruments: [tickerSchema.parse(ticker)],
      at: window.to,
    });
    expect(result.ok).toBe(true);
  });

  it("stamps dataVersion as the freshest asOf actually loaded", async () => {
    const db = getDb();
    const ticker = uniqueTicker("DVN");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-06-02", 5);
    await seedSessions(sessions);
    const lastSession = sessions.at(-1) ?? "";
    const lastAsOf = `${lastSession}T20:00:00.000Z`;
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    const view = await loadMarketView(db, window);

    expect(view.dataVersion).toBe(lastAsOf);
  });

  it("populates the option chain when the strategy's structure carries an option leg (round 2 item 1)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("OPT");
    cleanupTickers.push(ticker);
    const optionTicker = `${ticker}W1`;
    cleanupOptionTickers.push(optionTicker);

    const sessions = businessDays("2097-07-07", 40);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const firstSession = sessions[0] ?? "";
    const periodFrom = sessions[25] ?? "";
    const periodTo = sessions.at(-1) ?? "";
    const expiry = sessions.at(-1) ?? "";
    const priceSession = sessions[26] ?? "";

    await db.insert(optionSeries).values({
      isin: `ISIN-${optionTicker}`,
      ticker: optionTicker,
      underlying: ticker,
      right: "call",
      strike: "12.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });
    await ensureMonthlyPartition(db, "option_daily_prices", priceSession);
    await db.insert(optionDailyPrices).values({
      ticker: optionTicker,
      session: priceSession,
      asOf: new Date(`${priceSession}T20:00:00.000Z`),
      right: "call",
      strike: "12.00000000",
      expiry,
      average: "0.750000",
      close: "0.750000",
      trades: 1,
      tradedQuantity: 100,
    });

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: COVERED_CALL_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], periodFrom, periodTo);
    const view = await loadMarketView(db, window);

    expect(view.optionSeries.some((series) => series.ticker === optionTicker)).toBe(true);
    const prices = view.optionPrices.filter((price) => price.ticker === optionTicker);
    expect(prices).toHaveLength(1);
    expect(prices[0]?.close).toBe("0.750000");
  });

  it("extends the calendar through an option expiry past period.to (round 4 item 2)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("EXP");
    cleanupTickers.push(ticker);
    const optionTicker = `${ticker}W1`;
    cleanupOptionTickers.push(optionTicker);

    const sessions = businessDays("2097-10-06", 40);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const firstSession = sessions[0] ?? "";
    const periodFrom = sessions[25] ?? "";
    const periodTo = sessions[29] ?? "";
    const expiry = sessions.at(-1) ?? "";

    await db.insert(optionSeries).values({
      isin: `ISIN-${optionTicker}`,
      ticker: optionTicker,
      underlying: ticker,
      right: "call",
      strike: "12.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: COVERED_CALL_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], periodFrom, periodTo);
    const view = await loadMarketView(db, window);

    expect(expiry > periodTo).toBe(true);
    expect(view.calendar.some((session) => session.date === expiry)).toBe(true);
  });

  it("excludes a series that expired before the warmup session (round 4 item 2)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("PEX");
    cleanupTickers.push(ticker);
    const optionTicker = `${ticker}W1`;
    cleanupOptionTickers.push(optionTicker);

    const sessions = businessDays("2097-11-03", 40);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const firstSession = sessions[0] ?? "";
    const periodFrom = sessions[25] ?? "";
    const periodTo = sessions.at(-1) ?? "";
    const expiredExpiry = sessions[0] ?? "";

    await db.insert(optionSeries).values({
      isin: `ISIN-${optionTicker}`,
      ticker: optionTicker,
      underlying: ticker,
      right: "call",
      strike: "12.00000000",
      expiry: expiredExpiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: COVERED_CALL_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], periodFrom, periodTo);
    const view = await loadMarketView(db, window);

    expect(view.optionSeries.some((series) => series.ticker === optionTicker)).toBe(false);
  });

  it("does not query option series or prices for a stock-only strategy", async () => {
    const db = getDb();
    const ticker = uniqueTicker("STK");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-08-04", 25);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    const view = await loadMarketView(db, window);

    expect(view.optionSeries).toEqual([]);
    expect(view.optionPrices).toEqual([]);
  });

  it("refuses an option chain past the ticker cap with a typed error instead of an unbounded load (round 3 item 2)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("CAP");
    cleanupTickers.push(ticker);

    const sessions = businessDays("2097-09-03", 10);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const firstSession = sessions[0] ?? "";
    const expiry = sessions.at(-1) ?? "";
    for (let i = 0; i < 4; i += 1) {
      const optionTicker = `${ticker}W${String(i)}`;
      cleanupOptionTickers.push(optionTicker);
      await db.insert(optionSeries).values({
        isin: `ISIN-${optionTicker}`,
        ticker: optionTicker,
        underlying: ticker,
        right: "call",
        strike: `${String(10 + i)}.00000000`,
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      });
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: COVERED_CALL_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    await expect(loadMarketView(db, window, { optionChainTickerCap: 3 })).rejects.toBeInstanceOf(
      MarketViewTooLargeError,
    );
  });

  it("refuses an option-price row volume past the price cap even though a single series is under the chain cap (round 4 item 3)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("PRC");
    cleanupTickers.push(ticker);
    const optionTicker = `${ticker}W1`;
    cleanupOptionTickers.push(optionTicker);

    const sessions = businessDays("2097-12-02", 10);
    await seedSessions(sessions);
    for (const session of sessions) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const firstSession = sessions[0] ?? "";
    const expiry = sessions.at(-1) ?? "";
    await db.insert(optionSeries).values({
      isin: `ISIN-${optionTicker}`,
      ticker: optionTicker,
      underlying: ticker,
      right: "call",
      strike: "12.00000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });
    await ensureMonthlyPartition(db, "option_daily_prices", firstSession);
    for (const session of sessions) {
      await db.insert(optionDailyPrices).values({
        ticker: optionTicker,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        right: "call",
        strike: "12.00000000",
        expiry,
        average: "0.750000",
        close: "0.750000",
        trades: 1,
        tradedQuantity: 100,
      });
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: COVERED_CALL_STRUCTURE,
    };

    const window = await windowFor(strategy, [ticker], sessions[0] ?? "", sessions.at(-1) ?? "");
    await expect(loadMarketView(db, window, { optionPriceRowCap: 3 })).rejects.toBeInstanceOf(
      MarketViewTooLargeError,
    );
  });

  it("throws MarketViewUnavailableError instead of a candle-less view when the window has no trading session (round 2 item 9)", async () => {
    const db = getDb();

    await expect(
      loadMarketView(db, {
        from: "1990-01-01T00:00:00.000Z",
        to: "1990-01-02T00:00:00.000Z",
        instruments: [],
        timeframes: ["D1"],
        collections: ["candles"],
      }),
    ).rejects.toBeInstanceOf(MarketViewUnavailableError);
  });
});
