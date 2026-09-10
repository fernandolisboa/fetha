import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { StrategyVersion } from "@fetha/engine";

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
import {
  buildOperationMarketView,
  loadMarketView,
  MarketViewUnavailableError,
} from "./market-view";
import { upsertDailyCandles } from "./repositories/candle-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

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

afterEach(async () => {
  const db = getDb();
  const dates = seededSessionDates.splice(0);
  if (dates.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
  }
});

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

function businessDaysFrom(
  startYear: number,
  startMonth: number,
  startDay: number,
  count: number,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
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
  });

  it("loads warm-up candles before period.from for an SMA(20) strategy, not just the requested period", async () => {
    const db = getDb();
    const ticker = uniqueTicker("SMA");
    cleanupTickers.push(ticker);

    // 40 sessions so an SMA(20) warmup (~20 sessions back) reaches well
    // before `period.from`, the middle of the calendar below.
    const sessions = businessDaysFrom(2097, 3, 4, 40);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: periodFrom, to: periodTo },
    });

    const earliestLoadedSession = view.candles.map((c) => c.session).sort()[0];
    expect(earliestLoadedSession).toBeDefined();
    expect((earliestLoadedSession as string) < periodFrom).toBe(true);
  });

  it("populates corporate actions for every ticker in the universe", async () => {
    const db = getDb();
    const ticker = uniqueTicker("CAF");
    cleanupTickers.push(ticker);

    const sessions = businessDaysFrom(2097, 4, 6, 5);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: sessions[0] ?? "", to: sessions.at(-1) ?? "" },
    });

    expect(view.corporateActions).toEqual([
      { ticker, exDate, asOf: `${exDate}T13:00:00.000Z`, factor: "0.50000000" },
    ]);
  });

  it("populates macro points inside the loaded window", async () => {
    const db = getDb();
    const ticker = uniqueTicker("MAC");
    cleanupTickers.push(ticker);

    const sessions = businessDaysFrom(2097, 5, 4, 5);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: sessions[0] ?? "", to: sessions.at(-1) ?? "" },
    });

    expect(view.macro.some((point) => point.date === macroDate && point.series === "cdi")).toBe(
      true,
    );
  });

  it("stamps dataVersion as the freshest asOf actually loaded", async () => {
    const db = getDb();
    const ticker = uniqueTicker("DVN");
    cleanupTickers.push(ticker);

    const sessions = businessDaysFrom(2097, 6, 2, 5);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: sessions[0] ?? "", to: sessions.at(-1) ?? "" },
    });

    expect(view.dataVersion).toBe(lastAsOf);
  });

  it("populates the option chain when the strategy's structure carries an option leg (round 2 item 1)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("OPT");
    cleanupTickers.push(ticker);
    const optionTicker = `${ticker}W1`;
    cleanupOptionTickers.push(optionTicker);

    const sessions = businessDaysFrom(2097, 7, 7, 40);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: periodFrom, to: periodTo },
    });

    expect(view.optionSeries.some((series) => series.ticker === optionTicker)).toBe(true);
    const prices = view.optionPrices.filter((price) => price.ticker === optionTicker);
    expect(prices).toHaveLength(1);
    expect(prices[0]?.close).toBe("0.750000");
  });

  it("does not query option series or prices for a stock-only strategy", async () => {
    const db = getDb();
    const ticker = uniqueTicker("STK");
    cleanupTickers.push(ticker);

    const sessions = businessDaysFrom(2097, 8, 4, 25);
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

    const view = await loadMarketView(db, {
      strategy,
      universe: [ticker],
      period: { from: sessions[0] ?? "", to: sessions.at(-1) ?? "" },
    });

    expect(view.optionSeries).toEqual([]);
    expect(view.optionPrices).toEqual([]);
  });

  it("throws MarketViewUnavailableError instead of a candle-less view when the period has no trading session (round 2 item 9)", async () => {
    const db = getDb();
    const ticker = uniqueTicker("NOS");
    cleanupTickers.push(ticker);

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    await expect(
      loadMarketView(db, {
        strategy,
        universe: [ticker],
        period: { from: "1990-01-01", to: "1990-01-02" },
      }),
    ).rejects.toBeInstanceOf(MarketViewUnavailableError);
  });
});
