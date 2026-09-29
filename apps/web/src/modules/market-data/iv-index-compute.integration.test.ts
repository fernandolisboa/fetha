import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries, tradingSessions } from "./schema";

import { computeIvIndexForSession } from "./iv-index-compute";
import { DAILY_TIMEFRAME } from "./repositories/candle-repository";
import { ivIndexPointsInRange } from "./repositories/iv-index-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "21:00:00.000Z";

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

// Consecutive calendar days from a random far-future anchor (disjoint from
// every other integration fixture's own reserved range, see
// market-view.integration.test.ts's comment): the engine's own time-to-expiry
// math (packages/engine/src/internal/time-to-expiry.ts) counts sessions by
// their position in the calendar, not real trading days, so this does not
// need to skip weekends to reproduce the engine's own fixture in
// implied-volatility-index.test.ts.
function dailySessions(count: number): string[] {
  const year = 2086 + Math.floor(Math.random() * 4);
  const month = 1 + Math.floor(Math.random() * 6);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() + index);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

async function seedSessions(dates: string[]): Promise<void> {
  await getDb()
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

// A minimal, test-only Black-Scholes call price (r = 0, q = 0), never
// imported from the engine (CLAUDE.md: nothing outside packages/engine may
// depend on its internals): only used here to seed option premiums that
// solve back to a real implied volatility, not to assert an exact numeric
// target (that precision belongs to the engine's own
// implied-volatility-index.test.ts).
function erf(input: number): number {
  const sign = input < 0 ? -1 : 1;
  const x = Math.abs(input);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function bsCall(spot: number, strike: number, years: number, sigma: number): number {
  const d1 = (Math.log(spot / strike) + 0.5 * sigma * sigma * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  return spot * normalCdf(d1) - strike * normalCdf(d2);
}

async function seedUnderlyingSpot(
  underlying: string,
  session: string,
  close: string,
): Promise<void> {
  const db = getDb();
  await ensureMonthlyPartition(db, "candles", session);
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

async function seedCallSeries(
  underlying: string,
  ticker: string,
  session: string,
  expiry: string,
  strike: string,
  premium: string,
): Promise<void> {
  const db = getDb();
  await db.insert(optionSeries).values({
    isin: `ISIN-${ticker}`,
    ticker,
    underlying,
    right: "call",
    strike,
    expiry,
    style: "european",
    asOf: new Date(`${session}T${SESSION_OPEN_UTC}`),
  });
  await ensureMonthlyPartition(db, "option_daily_prices", session);
  await db.insert(optionDailyPrices).values({
    ticker,
    session,
    asOf: new Date(`${session}T${SESSION_CLOSE_UTC}`),
    right: "call",
    strike,
    expiry,
    average: premium,
    close: premium,
    trades: 1,
    tradedQuantity: 100,
  });
}

describe("computeIvIndexForSession", () => {
  const cleanupUnderlyings: string[] = [];
  const cleanupOptionTickers: string[] = [];
  const cleanupSessionDates: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const underlyings = cleanupUnderlyings.splice(0);
    if (underlyings.length > 0) {
      await db.delete(candles).where(inArray(candles.ticker, underlyings));
      await db.delete(optionSeries).where(inArray(optionSeries.underlying, underlyings));
    }
    const optionTickers = cleanupOptionTickers.splice(0);
    if (optionTickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
    }
    const sessionDates = cleanupSessionDates.splice(0);
    if (sessionDates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessionDates));
      await db.delete(macroPoints).where(inArray(macroPoints.date, sessionDates));
    }
  });

  it("writes one point stamped with the session's own close, for an underlying with calls bracketing 30 calendar days", async () => {
    const db = getDb();
    const sessions = dailySessions(45);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const session0 = sessions[0] ?? "";
    const expiryLower = sessions[20] ?? "";
    const expiryUpper = sessions[40] ?? "";

    await db.insert(macroPoints).values({
      series: "cdi",
      date: session0,
      asOf: new Date(`${session0}T${SESSION_OPEN_UTC}`),
      annualRate: "0.00000000",
    });

    const underlying = uniqueTicker("IVC");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");

    const spot = 50;
    const strike = 50;
    const sigmaLower = 0.2;
    const sigmaUpper = 0.4;
    const priceLower = bsCall(spot, strike, 20 / 252, sigmaLower);
    const priceUpper = bsCall(spot, strike, 40 / 252, sigmaUpper);

    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;
    cleanupOptionTickers.push(tickerLower, tickerUpper);
    await seedCallSeries(
      underlying,
      tickerLower,
      session0,
      expiryLower,
      "50.00000000",
      priceLower.toFixed(6),
    );
    await seedCallSeries(
      underlying,
      tickerUpper,
      session0,
      expiryUpper,
      "50.00000000",
      priceUpper.toFixed(6),
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const rowCount = await computeIvIndexForSession(db, session0, sessionClose);
    expect(rowCount).toBe(1);

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toHaveLength(1);
    const point = points[0];
    expect(point?.session).toBe(session0);
    expect(point?.method).toBe("atm_30d_variance_interpolated");
    expect(point?.asOf.toISOString()).toBe(sessionClose.toISOString());
    expect(point?.impliedVolatility).not.toBeNull();
    const iv = Number(point?.impliedVolatility);
    expect(iv).toBeGreaterThan(sigmaLower);
    expect(iv).toBeLessThan(sigmaUpper);
  });

  it("skips an underlying whose chain does not bracket 30 calendar days, without failing the rest of the session", async () => {
    const db = getDb();
    const sessions = dailySessions(45);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const session0 = sessions[0] ?? "";
    const expiryLower = sessions[20] ?? "";
    const expiryUpper = sessions[40] ?? "";
    const onlyExpiry = sessions[35] ?? "";

    await db.insert(macroPoints).values({
      series: "cdi",
      date: session0,
      asOf: new Date(`${session0}T${SESSION_OPEN_UTC}`),
      annualRate: "0.00000000",
    });

    const bracketed = uniqueTicker("BRK");
    const unbracketed = uniqueTicker("UNB");
    cleanupUnderlyings.push(bracketed, unbracketed);
    await seedUnderlyingSpot(bracketed, session0, "50.000000");
    await seedUnderlyingSpot(unbracketed, session0, "50.000000");

    const bracketedLower = `${bracketed}CL`;
    const bracketedUpper = `${bracketed}CH`;
    const unbracketedOnly = `${unbracketed}C1`;
    cleanupOptionTickers.push(bracketedLower, bracketedUpper, unbracketedOnly);

    await seedCallSeries(
      bracketed,
      bracketedLower,
      session0,
      expiryLower,
      "50.00000000",
      bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
    );
    await seedCallSeries(
      bracketed,
      bracketedUpper,
      session0,
      expiryUpper,
      "50.00000000",
      bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
    );
    // Every listed expiry on the same side of 30 calendar days ahead: the
    // engine reports `iv_index_not_bracketed` (a null impliedVolatility, not
    // an error), which the compute step must skip silently.
    await seedCallSeries(
      unbracketed,
      unbracketedOnly,
      session0,
      onlyExpiry,
      "50.00000000",
      bsCall(50, 50, 35 / 252, 0.3).toFixed(6),
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const rowCount = await computeIvIndexForSession(db, session0, sessionClose);
    expect(rowCount).toBe(1);

    const points = await ivIndexPointsInRange(db, [bracketed, unbracketed], session0, session0);
    expect(points.map((point) => point.underlying)).toEqual([bracketed]);
  });
});
