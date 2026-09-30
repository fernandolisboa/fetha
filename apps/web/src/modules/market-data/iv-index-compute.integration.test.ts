import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "@fetha/engine";

import { getDb } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries, tradingSessions } from "./schema";

import { computeIvIndexForSession } from "./iv-index-compute";
import { buildOperationMarketView } from "./market-view";
import { DAILY_TIMEFRAME } from "./repositories/candle-repository";
import { ivIndexPointsInRange, upsertIvIndexPoints } from "./repositories/iv-index-repository";
import { ensureMonthlyPartition } from "./repositories/partitions";

// Wraps the real implementation by default (mirrors
// strategies/evaluate-signals.integration.test.ts's own pattern): every
// test keeps using genuine `buildOperationMarketView` behaviour except the
// one below that overrides a single call to prove an unexpected error
// propagates instead of being swallowed as "0 rows, succeeded".
vi.mock("./market-view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./market-view")>();
  return { ...actual, buildOperationMarketView: vi.fn(actual.buildOperationMarketView) };
});
const buildOperationMarketViewMock = vi.mocked(buildOperationMarketView);

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

    buildOperationMarketViewMock.mockRejectedValueOnce(new Error("boom"));

    const sessionClose = new Date(`${session0}T${SESSION_CLOSE_UTC}`);
    await expect(computeIvIndexForSession(db, session0, sessionClose)).rejects.toThrow("boom");

    const points = await ivIndexPointsInRange(db, [underlying], session0, session0);
    expect(points).toEqual([]);
  });

  // `buildOperationMarketView` (market-view.ts) takes no cap options and
  // never throws MarketViewTooLargeError/MarketViewUnavailableError today —
  // only `loadMarketView`'s own chain and price-row caps do. There is
  // nothing to seed here that would exercise that skip branch through real
  // code; it exists for the day buildOperationMarketView grows one, not for
  // a reachable case today.

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
});
