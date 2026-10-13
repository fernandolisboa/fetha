import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";

import { buildAssetReadingView, loadAssetReading } from "./asset-reading";
import { DAILY_TIMEFRAME } from "./repositories/candle-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";
import {
  candles,
  impliedVolatilityIndexPoints,
  optionDailyPrices,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "./schema";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "21:00:00.000Z";

function uniqueTicker(): string {
  return tickerSchema.parse(
    `ZAR${crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase()}3`,
  );
}

// Consecutive days in a year no other fixture reserves (iv-index-compute uses 2086-2089).
function dailySessions(count: number): string[] {
  const month = 1 + Math.floor(Math.random() * 6);
  const cursor = new Date(Date.UTC(2095, month - 1, 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

describe("buildAssetReadingView and loadAssetReading", () => {
  const cleanupTickers: string[] = [];
  const cleanupOptionTickers: string[] = [];
  const cleanupSessions: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = cleanupTickers.splice(0);
    if (tickers.length > 0) {
      await db.delete(candles).where(inArray(candles.ticker, tickers));
      await db.delete(optionSeries).where(inArray(optionSeries.underlying, tickers));
      await db
        .delete(impliedVolatilityIndexPoints)
        .where(inArray(impliedVolatilityIndexPoints.underlying, tickers));
    }
    const optionTickers = cleanupOptionTickers.splice(0);
    if (optionTickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
      await db
        .delete(optionSeriesStrikes)
        .where(inArray(optionSeriesStrikes.ticker, optionTickers));
    }
    const sessions = cleanupSessions.splice(0);
    if (sessions.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
    }
  });

  it("loads the ticker's candles and IV points, and only the reading session's prices of its live chain", async () => {
    const db = getDb();
    const sessions = dailySessions(12);
    cleanupSessions.push(...sessions);
    await db
      .insert(tradingSessions)
      .values(
        sessions.map((date) => ({
          date,
          open: new Date(`${date}T${SESSION_OPEN_UTC}`),
          close: new Date(`${date}T${SESSION_CLOSE_UTC}`),
        })),
      )
      .onConflictDoNothing();

    const underlying = uniqueTicker();
    cleanupTickers.push(underlying);
    for (const [index, session] of sessions.entries()) {
      await ensureMonthlyPartition(db, "candles", session);
      const close = (20 + index).toFixed(6);
      await db.insert(candles).values({
        ticker: underlying,
        timeframe: DAILY_TIMEFRAME,
        session,
        asOf: new Date(`${session}T${SESSION_CLOSE_UTC}`),
        open: close,
        high: close,
        low: close,
        close,
        tradedQuantity: 1000,
      });
    }
    const lastSession = sessions.at(-1) ?? "";
    const previousSession = sessions.at(-2) ?? "";
    await db.insert(impliedVolatilityIndexPoints).values({
      underlying,
      session: lastSession,
      asOf: new Date(`${lastSession}T${SESSION_CLOSE_UTC}`),
      impliedVolatility: "0.31000000",
      method: "atm_30d_variance_interpolated",
    });

    const series = [
      { suffix: "A", expiry: "2095-12-15", tradedOnLast: true },
      { suffix: "B", expiry: "2095-12-15", tradedOnLast: false },
      { suffix: "C", expiry: previousSession, tradedOnLast: true },
    ];
    for (const entry of series) {
      const ticker = `${underlying}L${entry.suffix}`;
      cleanupOptionTickers.push(ticker);
      await db.insert(optionSeries).values({
        isin: `ISIN-${ticker}`,
        ticker,
        underlying,
        right: "call",
        strike: "25.00000000",
        expiry: entry.expiry,
        style: "american",
        asOf: new Date(`${sessions[0] ?? ""}T${SESSION_OPEN_UTC}`),
      });
      for (const session of [previousSession, lastSession]) {
        await ensureMonthlyPartition(db, "option_daily_prices", session);
        await db.insert(optionDailyPrices).values({
          ticker,
          session,
          asOf: new Date(`${session}T${SESSION_CLOSE_UTC}`),
          right: "call",
          strike: "25.00000000",
          expiry: entry.expiry,
          average: "1.000000",
          close: "1.000000",
          trades: session === lastSession && !entry.tradedOnLast ? 0 : 3,
          tradedQuantity: 100,
        });
      }
    }

    const at = new Date(`${lastSession}T23:00:00.000Z`);
    const view = await buildAssetReadingView(db, underlying, at);

    expect(view.candles.map((candle) => candle.session)).toEqual(sessions);
    expect(view.impliedVolatilityIndex.map((point) => point.impliedVolatility)).toEqual([
      "0.31000000",
    ]);
    expect(view.optionSeries.map((entry) => entry.expiry).sort()).toEqual([
      "2095-12-15",
      "2095-12-15",
    ]);
    expect(new Set(view.optionPrices.map((price) => price.session))).toEqual(
      new Set([lastSession]),
    );
    expect(view.calendar.at(-1)?.date).toBe(lastSession);

    const reading = await loadAssetReading(db, underlying, at);
    expect(reading?.session).toBe(lastSession);
    expect(reading?.impliedVolatility.latest).toEqual({
      session: lastSession,
      impliedVolatility: "0.31000000",
    });
    expect(reading?.options).toMatchObject({
      label: "thin",
      session: lastSession,
      tradedSeries: 1,
      nextExpiries: [{ expiry: "2095-12-15", series: 2, tradedSeries: 1 }],
    });
  });
});
