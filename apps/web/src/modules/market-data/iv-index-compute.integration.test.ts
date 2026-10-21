import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { instantSchema, quantitySchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { engine } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  candles,
  impliedVolatilityIndexPoints,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "./schema";

import { computeIvIndexForSession } from "./iv-index-compute";
import {
  buildIvIndexMarketView,
  buildOperationMarketView,
  loadIvIndexSessionCalendar,
} from "./market-view";
import { DAILY_TIMEFRAME } from "./repositories/candle-repository";
import { ivIndexPointsInRange, upsertIvIndexPoints } from "./repositories/iv-index-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";

// Wraps the real implementation by default (mirrors
// strategies/evaluate-signals.integration.test.ts's own pattern): every
// test keeps using genuine `buildIvIndexMarketView` behaviour except the
// one below that overrides a single call to prove an unexpected error
// propagates instead of being swallowed as "0 rows, succeeded".
vi.mock("./market-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./market-view")>();
  return { ...actual, buildIvIndexMarketView: vi.fn(actual.buildIvIndexMarketView) };
});
const buildIvIndexMarketViewMock = vi.mocked(buildIvIndexMarketView);

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

// Same model, with the continuous carry `resolveRiskFreeRate` derives from a CDI annual
// rate (r = ln(1 + cdi)): used only where the seeded CDI is non-zero, so the premium the
// engine solves back from still implies the seed sigma.
function bsCallWithRate(
  spot: number,
  strike: number,
  years: number,
  sigma: number,
  r: number,
): number {
  const d1 =
    (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  return spot * normalCdf(d1) - strike * Math.exp(-r * years) * normalCdf(d2);
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
  registry: { priceFactor: string; settlementStyle: "cash" | "physical" } = {
    priceFactor: "1",
    settlementStyle: "physical",
  },
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
    priceFactor: registry.priceFactor,
    settlementStyle: registry.settlementStyle,
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
      await db
        .delete(impliedVolatilityIndexPoints)
        .where(inArray(impliedVolatilityIndexPoints.underlying, underlyings));
    }
    const optionTickers = cleanupOptionTickers.splice(0);
    if (optionTickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
      await db
        .delete(optionSeriesStrikes)
        .where(inArray(optionSeriesStrikes.ticker, optionTickers));
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
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 1, pending: false });

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toHaveLength(1);
    const point = points[0];
    expect(point?.session).toBe(session0);
    expect(point?.method).toBe("atm_30d_variance_interpolated");
    expect(point?.asOf.toISOString()).toBe(sessionClose.toISOString());
    expect(point?.impliedVolatility).not.toBeNull();
    const iv = Number(point?.impliedVolatility);
    // T1=20/252, T2=40/252, T30=30/252, w=0.5: sqrt((0.04*20 + 0.16*40) / (2*30)) =
    // sqrt(0.12), the same closed-form target as the engine's own
    // implied-volatility-index.test.ts fixture this mirrors.
    expect(iv).toBeCloseTo(Math.sqrt(0.12), 3);
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
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 1, pending: false });

    const points = await ivIndexPointsInRange(db, [bracketed, unbracketed], session0, session0);
    expect(points.map((point) => point.underlying)).toEqual([bracketed]);
  });

  it("lets an unexpected error propagate instead of silently succeeding with 0 rows", async () => {
    const db = getDb();
    const sessions = dailySessions(3);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const session0 = sessions[0] ?? "";
    const expiry = sessions[2] ?? "";

    await db.insert(macroPoints).values({
      series: "cdi",
      date: session0,
      asOf: new Date(`${session0}T${SESSION_OPEN_UTC}`),
      annualRate: "0.00000000",
    });

    const underlying = uniqueTicker("ERR");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");
    const optionTicker = `${underlying}C1`;
    cleanupOptionTickers.push(optionTicker);
    await seedCallSeries(underlying, optionTicker, session0, expiry, "50.00000000", "1.000000");

    buildIvIndexMarketViewMock.mockRejectedValueOnce(new Error("boom"));

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    await expect(computeIvIndexForSession(db, session0, sessionClose)).rejects.toThrow("boom");

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toEqual([]);
  });

  // `buildIvIndexMarketView` (market-view.ts) takes no cap options and
  // never throws MarketViewTooLargeError/MarketViewUnavailableError today —
  // only `loadMarketView`'s own chain and price-row caps do. There is
  // nothing to seed here that would exercise that skip branch through real
  // code; it exists for the day the view grows one, not for a reachable
  // case today.

  it("never solves from a bracket leg whose only premium is stale (priced on a prior session), even though buildOperationMarketView still carries it", async () => {
    const db = getDb();
    const sessions = dailySessions(46);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const prevSession = sessions[0] ?? "";
    const session0 = sessions[1] ?? "";
    const expiryLower = sessions[21] ?? "";
    const expiryUpper = sessions[41] ?? "";
    const farOtmExpiry = sessions[11] ?? "";

    await db.insert(macroPoints).values({
      series: "cdi",
      date: prevSession,
      asOf: new Date(`${prevSession}T${SESSION_OPEN_UTC}`),
      annualRate: "0.00000000",
    });

    const underlying = uniqueTicker("STL");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");

    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;
    const tickerFarOtm = `${underlying}CF`;
    cleanupOptionTickers.push(tickerLower, tickerUpper, tickerFarOtm);

    // The ATM bracket's only premiums are on `prevSession`, one session
    // before the one being computed: `buildOperationMarketView` still
    // carries them (its own `latestOptionPricesAt` looks back ~30 sessions),
    // but they must not be usable to solve `session0`'s own point.
    await seedCallSeries(
      underlying,
      tickerLower,
      prevSession,
      expiryLower,
      "50.00000000",
      bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
    );
    await seedCallSeries(
      underlying,
      tickerUpper,
      prevSession,
      expiryUpper,
      "50.00000000",
      bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
    );
    // A deep out-of-the-money trade on `session0` itself, only so this
    // underlying is a candidate for `session0`'s own compute pass at all.
    await seedCallSeries(
      underlying,
      tickerFarOtm,
      session0,
      farOtmExpiry,
      "5.00000000",
      "45.000000",
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 0, pending: false });

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toEqual([]);
  });

  it("skips a bracket leg whose price the live writers' same-session tie recorded under a strike the engine does not resolve (#274 round 2)", async () => {
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

    const underlying = uniqueTicker("TIE");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");

    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;
    cleanupOptionTickers.push(tickerLower, tickerUpper);

    // The registry's new epoch (14.98) and COTAHIST's old-strike price row
    // (29.95) share the exact same as_of this session — `ingest.ts` stamps
    // both writes with the session's own close, so a corporate-action
    // session where the two sources disagree lands exactly here (ADR-0056's
    // #274 amendment). The engine resolves the lower strike on an exact tie
    // (`isEarlierOnExactTie`), so this leg's premium must never reach it:
    // it was recorded under 29.95, not the 14.98 the engine prices against.
    await db.insert(optionSeries).values({
      isin: `ISIN-${tickerLower}`,
      ticker: tickerLower,
      underlying,
      right: "call",
      strike: "14.98000000",
      expiry: expiryLower,
      style: "european",
      asOf: new Date(`${session0}T${SESSION_OPEN_UTC}`),
    });
    const tieAsOf = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    await db.insert(optionSeriesStrikes).values([
      {
        ticker: tickerLower,
        expiry: expiryLower,
        right: "call",
        strike: "29.95000000",
        asOf: tieAsOf,
      },
      {
        ticker: tickerLower,
        expiry: expiryLower,
        right: "call",
        strike: "14.98000000",
        asOf: tieAsOf,
      },
    ]);
    await ensureMonthlyPartition(db, "option_daily_prices", session0);
    const oldStrikePremium = bsCall(50, 50, 20 / 252, 0.2).toFixed(6);
    await db.insert(optionDailyPrices).values({
      ticker: tickerLower,
      session: session0,
      asOf: tieAsOf,
      right: "call",
      strike: "29.95000000",
      expiry: expiryLower,
      average: oldStrikePremium,
      close: oldStrikePremium,
      trades: 1,
      tradedQuantity: 100,
    });

    await seedCallSeries(
      underlying,
      tickerUpper,
      session0,
      expiryUpper,
      "50.00000000",
      bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 0, pending: false });

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toEqual([]);
  });

  it("stays pending, writing no point, when no CDI point is visible on or after the previous trading session", async () => {
    const db = getDb();
    const sessions = dailySessions(45);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const session0 = sessions[1] ?? "";
    const expiryLower = sessions[21] ?? "";
    const expiryUpper = sessions[41] ?? "";

    // No CDI point seeded at all: `resolveRiskFreeRate` would otherwise
    // default r=0 silently and bake it into a point that is never
    // recomputed once persisted.
    const underlying = uniqueTicker("CDI");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");
    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;
    cleanupOptionTickers.push(tickerLower, tickerUpper);
    await seedCallSeries(
      underlying,
      tickerLower,
      session0,
      expiryLower,
      "50.00000000",
      bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
    );
    await seedCallSeries(
      underlying,
      tickerUpper,
      session0,
      expiryUpper,
      "50.00000000",
      bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 0, pending: true });

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toEqual([]);
  });

  it("settles the first session of the calendar with no point instead of leaving it pending forever, since no CDI can ever be visible at its close (#264)", async () => {
    const db = getDb();
    // Before every session any fixture or the real calendar seeds, so it has
    // no earlier trading session, as the first ingested session does.
    const session0 = "1990-01-02";
    const session1 = "1990-01-03";
    cleanupSessionDates.push(session0, session1);
    await seedSessions([session0, session1]);

    const underlying = uniqueTicker("FLR");
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "50.000000");
    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;
    cleanupOptionTickers.push(tickerLower, tickerUpper);
    await seedCallSeries(
      underlying,
      tickerLower,
      session0,
      "1990-01-22",
      "50.00000000",
      bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
    );
    await seedCallSeries(
      underlying,
      tickerUpper,
      session0,
      "1990-02-11",
      "50.00000000",
      bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
    );
    // The session's own CDI, stamped at the next session's open as Bacen
    // publishes it: invisible at its close.
    await db.insert(macroPoints).values({
      series: "cdi",
      date: session0,
      asOf: new Date(`${session1}T${SESSION_OPEN_UTC}`),
      annualRate: "0.10000000",
    });

    const result = await computeIvIndexForSession(
      db,
      session0,
      new Date(`${session0}T${SESSION_CLOSE_UTC}`),
    );
    expect(result).toEqual({ rowCount: 0, pending: false });
    expect(await ivIndexPointsInRange(db, [underlying], session0, session0)).toEqual([]);
  });

  it("resumes only the underlyings still missing a point once the hard stop has already passed, keeping what an earlier call already wrote", async () => {
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

    const done = uniqueTicker("DON");
    const pending = uniqueTicker("PEN");
    cleanupUnderlyings.push(done, pending);
    await seedUnderlyingSpot(done, session0, "50.000000");
    await seedUnderlyingSpot(pending, session0, "50.000000");

    for (const underlying of [done, pending]) {
      await seedCallSeries(
        underlying,
        `${underlying}CL`,
        session0,
        expiryLower,
        "50.00000000",
        bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
      );
      await seedCallSeries(
        underlying,
        `${underlying}CH`,
        session0,
        expiryUpper,
        "50.00000000",
        bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
      );
      cleanupOptionTickers.push(`${underlying}CL`, `${underlying}CH`);
    }

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);

    // Simulates an earlier, interrupted call that already wrote `done`'s
    // point for this session, without going through the compute step itself.
    await upsertIvIndexPoints(db, [
      {
        underlying: done,
        session: session0,
        asOf: sessionClose,
        impliedVolatility: "0.25000000",
        method: "atm_30d_variance_interpolated",
      },
    ]);

    // Only `pending` is left to compute; a hard stop already in the past
    // must be checked before it starts, so this call keeps `done`'s point
    // untouched and reports the session as still pending instead of
    // recomputing anything.
    const stoppedResult = await computeIvIndexForSession(
      db,
      session0,
      sessionClose,
      Date.now() - 1,
    );
    expect(stoppedResult).toEqual({ rowCount: 0, pending: true });

    const afterStop = await ivIndexPointsInRange(db, [done, pending], session0, session0);
    expect(afterStop.map((point) => point.underlying)).toEqual([done]);

    const finished = await computeIvIndexForSession(db, session0, sessionClose);
    expect(finished).toEqual({ rowCount: 1, pending: false });

    const points = await ivIndexPointsInRange(db, [done, pending], session0, session0);
    expect(points.map((point) => point.underlying).sort()).toEqual([done, pending].sort());
  });

  it("writes what it could and reports pending, not succeeded, when the engine itself returns ok:false for one underlying", async () => {
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

    const good = uniqueTicker("OKY");
    const bad = uniqueTicker("BAD");
    cleanupUnderlyings.push(good, bad);
    await seedUnderlyingSpot(good, session0, "50.000000");
    await seedUnderlyingSpot(bad, session0, "50.000000");

    for (const underlying of [good, bad]) {
      await seedCallSeries(
        underlying,
        `${underlying}CL`,
        session0,
        expiryLower,
        "50.00000000",
        bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
      );
      await seedCallSeries(
        underlying,
        `${underlying}CH`,
        session0,
        expiryUpper,
        "50.00000000",
        bsCall(50, 50, 40 / 252, 0.4).toFixed(6),
      );
      cleanupOptionTickers.push(`${underlying}CL`, `${underlying}CH`);
    }

    const originalImpliedVolatilityIndex = engine.impliedVolatilityIndex.bind(engine);
    const engineSpy = vi
      .spyOn(engine, "impliedVolatilityIndex")
      .mockImplementation(async (input) => {
        if (input.underlying === bad) {
          return { ok: false, error: { code: "missing_instrument", ticker: bad } };
        }
        return originalImpliedVolatilityIndex(input);
      });

    try {
      const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
      const result = await computeIvIndexForSession(db, session0, sessionClose);
      expect(result.pending).toBe(true);

      const points = await ivIndexPointsInRange(db, [good, bad], session0, session0);
      expect(points.map((point) => point.underlying)).toEqual([good]);
    } finally {
      engineSpy.mockRestore();
    }
  });

  // ADR-0062/ADR-0063 (#307): the Ibovespa index candle and a cash-settled index
  // option (`price_factor` 100) through the exact same pipeline every other
  // underlying uses. A flat 27.4% volatility curve is used for both bracket legs
  // so the 30-calendar-day interpolation's own weighting is irrelevant: whatever
  // the weights, interpolating a constant variance returns that same volatility —
  // this pins that the recovered IV still equals the seeded sigma once a non-zero
  // CDI carry is in the premiums, not any particular level of the Ibovespa's IV.
  it("prices an IBOV11 (Ibovespa) index option through priceFactor and writes IBOV11 an iv_index point near 27.4%", async () => {
    const db = getDb();
    const sessions = dailySessions(130);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);

    const session0 = sessions[0] ?? "";
    const expiryLower = sessions[20] ?? "";
    const expiryUpper = sessions[127] ?? "";

    const cdi = 0.149;
    await db.insert(macroPoints).values({
      series: "cdi",
      date: session0,
      asOf: new Date(`${session0}T${SESSION_OPEN_UTC}`),
      annualRate: cdi.toFixed(8),
    });

    const underlying = "IBOV11";
    cleanupUnderlyings.push(underlying);
    await seedUnderlyingSpot(underlying, session0, "187366.840000");

    const strike = "183000.00000000";
    const priceFactor = "100.000000";
    const flatSigma = 0.274;
    // `resolveRiskFreeRate` turns a CDI annual rate into the model's continuous
    // carry, r = ln(1 + cdi) (ADR-0013): the same conversion the engine applies,
    // so the premiums below solve back to `flatSigma`, not a biased value.
    const r = Math.log(1 + cdi);

    // `bsCallWithRate` solves in the series' own quotation unit (index points); the
    // registry's `price_factor` of 100 (ADR-0063) is what scales that back down
    // to the premium actually traded and stored, reais per contract.
    const lowerPremium = (bsCallWithRate(187366.84, 183000, 20 / 252, flatSigma, r) / 100).toFixed(
      6,
    );
    const upperPremium = (bsCallWithRate(187366.84, 183000, 127 / 252, flatSigma, r) / 100).toFixed(
      6,
    );

    const tickerLower = `${underlying}CL`;
    const tickerUpper = "IBOVA183";
    cleanupOptionTickers.push(tickerLower, tickerUpper);
    const registry = { priceFactor, settlementStyle: "cash" as const };
    await seedCallSeries(
      underlying,
      tickerLower,
      session0,
      expiryLower,
      strike,
      lowerPremium,
      registry,
    );
    await seedCallSeries(
      underlying,
      tickerUpper,
      session0,
      expiryUpper,
      strike,
      upperPremium,
      registry,
    );

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    const result = await computeIvIndexForSession(db, session0, sessionClose);
    expect(result).toEqual({ rowCount: 1, pending: false });

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toHaveLength(1);
    const iv = Number(points[0]?.impliedVolatility);
    expect(iv).toBeCloseTo(flatSigma, 2);
    expect(iv).toBeGreaterThan(0.26);
    expect(iv).toBeLessThan(0.29);

    const at = sessionClose.toISOString();
    const view = await buildOperationMarketView(db, tickerSchema.parse(underlying), at);
    const pricing = await engine.priceOperation({
      view,
      at,
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: tickerSchema.parse(tickerUpper),
          quantity: quantitySchema.parse(1),
        },
      ],
      openOperationCount: 0,
    });
    expect(pricing.ok).toBe(true);
    if (!pricing.ok) return;
    const leg = pricing.value.legs[0];
    expect(leg?.impliedVolatility).not.toBeNull();
    expect(Number(leg?.impliedVolatility)).toBeCloseTo(flatSigma, 1);
    expect(leg?.greeks).not.toBeNull();
  });

  describe("buildIvIndexMarketView", () => {
    async function seedCdi(date: string): Promise<void> {
      await getDb()
        .insert(macroPoints)
        .values({
          series: "cdi",
          date,
          asOf: new Date(`${date}T${SESSION_OPEN_UTC}`),
          annualRate: "0.00000000",
        });
    }

    async function ivFrom(
      view: Awaited<ReturnType<typeof buildOperationMarketView>>,
      underlying: string,
      session: string,
      at: string,
    ) {
      const optionPrices = view.optionPrices.filter((price) => price.session === session);
      const result = await engine.impliedVolatilityIndex({
        view: { ...view, optionPrices },
        underlying: tickerSchema.parse(underlying),
        at: instantSchema.parse(at),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return null;
      return {
        impliedVolatility: result.value.impliedVolatility,
        seriesUsed: [...result.value.seriesUsed].sort(),
      };
    }

    it("reads the chain only through the bracket's upper expiry and solves the same point as the full view (#334)", async () => {
      const db = getDb();
      const sessions = dailySessions(75);
      cleanupSessionDates.push(...sessions);
      await seedSessions(sessions);

      const session0 = sessions[0] ?? "";
      await seedCdi(session0);

      const underlying = uniqueTicker("NRW");
      cleanupUnderlyings.push(underlying);
      await seedUnderlyingSpot(underlying, session0, "50.000000");

      const tickerLower = `${underlying}CL`;
      const tickerUpper = `${underlying}CH`;
      const tickerLeaps = `${underlying}CZ`;
      cleanupOptionTickers.push(tickerLower, tickerUpper, tickerLeaps);
      for (const [ticker, index, sigma] of [
        [tickerLower, 20, 0.2],
        [tickerUpper, 40, 0.4],
        [tickerLeaps, 70, 0.3],
      ] as const) {
        await seedCallSeries(
          underlying,
          ticker,
          session0,
          sessions[index] ?? "",
          "50.00000000",
          bsCall(50, 50, index / 252, sigma).toFixed(6),
        );
      }

      const at = new Date(`${session0}T${SESSION_CLOSE_UTC}`).toISOString();
      const full = await buildOperationMarketView(
        db,
        tickerSchema.parse(underlying),
        instantSchema.parse(at),
      );
      const narrowed = await buildIvIndexMarketView(
        db,
        tickerSchema.parse(underlying),
        sessionDateSchema.parse(session0),
        await loadIvIndexSessionCalendar(db, instantSchema.parse(at)),
      );

      expect(full.optionSeries.map((series) => series.ticker)).toContain(tickerLeaps);
      expect(narrowed.optionSeries.map((series) => series.ticker).sort()).toEqual(
        [tickerUpper, tickerLower].sort(),
      );
      const fromNarrowed = await ivFrom(narrowed, underlying, session0, at);
      expect(fromNarrowed?.impliedVolatility).not.toBeNull();
      expect(fromNarrowed).toEqual(await ivFrom(full, underlying, session0, at));
    });

    it("falls back to the full chain when the first expiry past the target only survives on a ticker B3 relisted for a later cycle (#334, ADR-0017)", async () => {
      const db = getDb();
      const sessions = dailySessions(75);
      cleanupSessionDates.push(...sessions);
      await seedSessions(sessions);

      const prevSession = sessions[0] ?? "";
      const session0 = sessions[1] ?? "";
      await seedCdi(prevSession);

      const underlying = uniqueTicker("RLS");
      cleanupUnderlyings.push(underlying);
      await seedUnderlyingSpot(underlying, session0, "50.000000");

      const tickerLower = `${underlying}CL`;
      const tickerUpper = `${underlying}CH`;
      const tickerReused = `${underlying}CR`;
      cleanupOptionTickers.push(tickerLower, tickerUpper, tickerReused);
      await seedCallSeries(
        underlying,
        tickerLower,
        session0,
        sessions[21] ?? "",
        "50.00000000",
        bsCall(50, 50, 20 / 252, 0.2).toFixed(6),
      );
      await seedCallSeries(
        underlying,
        tickerUpper,
        session0,
        sessions[51] ?? "",
        "50.00000000",
        bsCall(50, 50, 50 / 252, 0.4).toFixed(6),
      );
      // The reused ticker's earlier cycle expires right after the target, ahead of the true
      // upper leg; its latest epoch (the one the engine resolves) moved to a far expiry.
      await db.insert(optionSeries).values({
        isin: `ISIN-${tickerReused}-OLD`,
        ticker: tickerReused,
        underlying,
        right: "call",
        strike: "50.00000000",
        expiry: sessions[41] ?? "",
        style: "european",
        asOf: new Date(`${prevSession}T${SESSION_OPEN_UTC}`),
        priceFactor: "1",
        settlementStyle: "physical",
      });
      await seedCallSeries(
        underlying,
        tickerReused,
        session0,
        sessions[71] ?? "",
        "50.00000000",
        bsCall(50, 50, 70 / 252, 0.3).toFixed(6),
      );

      const at = new Date(`${session0}T${SESSION_CLOSE_UTC}`).toISOString();
      const full = await buildOperationMarketView(
        db,
        tickerSchema.parse(underlying),
        instantSchema.parse(at),
      );
      const narrowed = await buildIvIndexMarketView(
        db,
        tickerSchema.parse(underlying),
        sessionDateSchema.parse(session0),
        await loadIvIndexSessionCalendar(db, instantSchema.parse(at)),
      );

      expect(narrowed.optionSeries.map((series) => series.ticker)).toContain(tickerUpper);
      const fromNarrowed = await ivFrom(narrowed, underlying, session0, at);
      expect(fromNarrowed?.impliedVolatility).not.toBeNull();
      expect(fromNarrowed?.seriesUsed).toEqual([tickerUpper, tickerLower].sort());
      expect(fromNarrowed).toEqual(await ivFrom(full, underlying, session0, at));
    });
  });
});
