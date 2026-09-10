import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { engine } from "@fetha/engine";
import { quantitySchema, tickerSchema, type ContemplatedLeg } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { candles, optionDailyPrices, optionSeries, tradingSessions } from "@/db/schema/market-data";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { buildOperationMarketView, optionChainForUnderlying } from "@/modules/market-data";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";

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

async function seedSessions(dates: string[]): Promise<void> {
  const db = getDb();
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

describe("a manually built collar prices from the priceable chain (PR #76 round 3)", () => {
  const cleanupUnderlyings: string[] = [];
  const cleanupTickers: string[] = [];
  const seededSessionDates: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const underlying of cleanupUnderlyings.splice(0)) {
      await db.delete(candles).where(eq(candles.ticker, underlying));
      await db.delete(optionSeries).where(eq(optionSeries.underlying, underlying));
    }
    const priced = cleanupTickers.splice(0);
    if (priced.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, priced));
    }
    const dates = seededSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
  });

  it("prices a stock + put + call collar built from the chain's priceable series, and skips its untraded series", async () => {
    const underlying = tickerSchema.parse(uniqueTicker("COL"));
    cleanupUnderlyings.push(underlying);
    const db = getDb();

    const sessions = businessDays("2099-08-02", 10);
    const firstSession = sessions[0];
    const stockSession = sessions[2];
    const priceSession = sessions[3];
    const currentSession = sessions[4];
    const expiry = sessions[9];
    if (!firstSession || !stockSession || !priceSession || !currentSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);
    seededSessionDates.push(...sessions);

    await upsertDailyCandles(db, stockSession, new Date(`${stockSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: stockSession,
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

    const putTicker = `${underlying}W1`;
    const callTicker = `${underlying}Z1`;
    const untradedTicker = `${underlying}Z9`;

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${underlying}-PUT`,
        ticker: putTicker,
        underlying,
        right: "put",
        strike: "28.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
      {
        isin: `ISIN-${underlying}-CALL`,
        ticker: callTicker,
        underlying,
        right: "call",
        strike: "32.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
      {
        isin: `ISIN-${underlying}-UNTRADED`,
        ticker: untradedTicker,
        underlying,
        right: "call",
        strike: "34.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
    ]);

    await ensureMonthlyPartition(db, "option_daily_prices", priceSession);
    cleanupTickers.push(putTicker, callTicker);
    await db.insert(optionDailyPrices).values([
      {
        ticker: putTicker,
        session: priceSession,
        asOf: new Date(`${priceSession}T20:00:00.000Z`),
        right: "put",
        strike: "28.00000000",
        expiry,
        average: "1.150000",
        close: "1.200000",
        trades: 5,
        tradedQuantity: 500,
      },
      {
        ticker: callTicker,
        session: priceSession,
        asOf: new Date(`${priceSession}T20:00:00.000Z`),
        right: "call",
        strike: "32.00000000",
        expiry,
        average: "0.950000",
        close: "1.000000",
        trades: 5,
        tradedQuantity: 500,
      },
    ]);

    const at = `${currentSession}T14:00:00.000Z`;

    const chain = await optionChainForUnderlying(db, underlying, currentSession, new Date(at));
    const putSeries = chain.find((series) => series.ticker === putTicker);
    const callSeries = chain.find((series) => series.ticker === callTicker);
    const untradedSeries = chain.find((series) => series.ticker === untradedTicker);

    expect(putSeries?.lastPrice).toEqual({ value: "1.200000", session: priceSession });
    expect(callSeries?.lastPrice).toEqual({ value: "1.000000", session: priceSession });
    expect(untradedSeries?.lastPrice).toBeNull();

    const legs: ContemplatedLeg[] = [
      { role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) },
      {
        role: "put",
        side: "buy",
        ticker: tickerSchema.parse(putTicker),
        quantity: quantitySchema.parse(1),
      },
      {
        role: "call",
        side: "sell",
        ticker: tickerSchema.parse(callTicker),
        quantity: quantitySchema.parse(1),
      },
    ];

    const view = await buildOperationMarketView(db, underlying, at);
    const result = await engine.priceOperation({ view, at, legs, openOperationCount: 0 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes.some((note) => note.code === "no_market_price")).toBe(false);
    expect(result.value.legs).toHaveLength(3);
    for (const leg of result.value.legs) {
      expect(leg.price).not.toBeNull();
    }
  });
});
