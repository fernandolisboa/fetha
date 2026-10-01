import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { instrumentOptionSeriesSchema } from "../adapters/b3-instruments/schema";
import { cotahistOptionRowSchema } from "../adapters/cotahist/schema";
import {
  candles,
  optionDailyPrices,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "../schema";

import { ensureMonthlyPartition } from "./partitions";
import {
  latestExpiredTradedSeries,
  optionChainForUnderlying,
  optionPricesInSessionRange,
  optionSeriesDetail,
  optionSeriesForFills,
  optionSeriesInWindow,
  searchOptionSeries,
  seriesKey,
  upsertOptionDailyPrices,
  upsertOptionSeries,
} from "./option-repository";

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
      await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, priced));
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

  it("excludes a series expiring today once today's session has closed", async () => {
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
    expect(series?.lastPriceStrike).toBeNull();
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

describe("optionChainForUnderlying price matching against strike epochs (#274, ADR-0056)", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
    }
    const priced = pricedTickers.splice(0);
    if (priced.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, priced));
      await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, priced));
    }
    const dates = seededSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
  });

  function seriesRow(fields: {
    ticker: string;
    isin: string;
    underlying: string;
    strike: string;
    expiry: string;
    asOf: string;
  }) {
    return instrumentOptionSeriesSchema.parse({
      ticker: fields.ticker,
      isin: fields.isin,
      underlying: fields.underlying,
      right: "call",
      strike: fields.strike,
      expiry: fields.expiry,
      style: "european",
      asOf: fields.asOf,
    });
  }

  function priceRow(fields: {
    ticker: string;
    session: string;
    strike: string;
    expiry: string;
    close: string;
  }) {
    return cotahistOptionRowSchema.parse({
      kind: "option",
      session: fields.session,
      ticker: fields.ticker,
      right: "call",
      strike: fields.strike,
      expiry: fields.expiry,
      factor: "1.000000",
      open: fields.close,
      high: fields.close,
      low: fields.close,
      average: fields.close,
      close: fields.close,
      trades: 1,
      tradedQuantity: 100,
    });
  }

  it("(b) shows a strike-change session's last price one session later, after the registry has already moved the strike", async () => {
    const underlying = uniqueTicker("CRP");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}B310`;
    const isin = `ISIN-${optionTicker}`;
    const sessions = businessDays("2099-08-02", 6);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const oldStrikeSession = sessions[1];
    const strikeChangeSession = sessions[2];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !oldStrikeSession || !strikeChangeSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await upsertOptionSeries(db, new Date(`${firstSession}T13:00:00.000Z`), [
      seriesRow({
        ticker: optionTicker,
        isin,
        underlying,
        strike: "29.95000000",
        expiry,
        asOf: firstSession,
      }),
    ]);

    await ensureMonthlyPartition(db, "option_daily_prices", oldStrikeSession);
    pricedTickers.push(optionTicker);
    await upsertOptionDailyPrices(
      db,
      oldStrikeSession,
      new Date(`${oldStrikeSession}T20:00:00.000Z`),
      [
        priceRow({
          ticker: optionTicker,
          session: oldStrikeSession,
          strike: "29.95000000",
          expiry,
          close: "2.000000",
        }),
      ],
    );

    // The registry adjusts the strike for the corporate action one session
    // later, with no new COTAHIST price row ingested for that ticker yet:
    // the latest visible price row still carries the pre-event strike.
    await upsertOptionSeries(db, new Date(`${strikeChangeSession}T13:00:00.000Z`), [
      seriesRow({
        ticker: optionTicker,
        isin,
        underlying,
        strike: "14.98000000",
        expiry,
        asOf: strikeChangeSession,
      }),
    ]);

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.strike).toBe("14.98000000");
    expect(series?.lastPrice).toEqual({ value: "2.000000", session: oldStrikeSession });
    expect(series?.lastPriceStrike).toBe("29.95000000");
  });

  it("(a) shows a price row's own strike even when the registry's new epoch for the same session shares the exact same as_of (live-writer tie)", async () => {
    const underlying = uniqueTicker("TIE");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}B310`;
    const sessions = businessDays("2099-09-02", 6);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const tieSession = sessions[1];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !tieSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values({
      isin: `ISIN-${optionTicker}`,
      ticker: optionTicker,
      underlying,
      right: "call",
      strike: "14.98000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });
    const tieAsOf = new Date(`${tieSession}T20:00:00.000Z`);
    pricedTickers.push(optionTicker);
    // `ingest.ts` stamps the registry write and the COTAHIST write for one
    // session with the same `trading.close`: on the session the two sources
    // disagree, the pre- and post-event epoch land on the exact same as_of.
    await db.insert(optionSeriesStrikes).values([
      { ticker: optionTicker, expiry, right: "call", strike: "29.95000000", asOf: tieAsOf },
      { ticker: optionTicker, expiry, right: "call", strike: "14.98000000", asOf: tieAsOf },
    ]);

    await ensureMonthlyPartition(db, "option_daily_prices", tieSession);
    await db.insert(optionDailyPrices).values({
      ticker: optionTicker,
      session: tieSession,
      asOf: tieAsOf,
      right: "call",
      strike: "29.95000000",
      expiry,
      average: "2.000000",
      close: "2.000000",
      trades: 1,
      tradedQuantity: 100,
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.lastPrice).toEqual({ value: "2.000000", session: tieSession });
    expect(series?.strike).toBe("14.98000000");
    expect(series?.lastPriceStrike).toBe("29.95000000");
  });

  it("(d) matches whichever of two same-as_of epochs a price row's own strike carries, independent of row order", async () => {
    const underlying = uniqueTicker("ORD");
    cleanupTickers.push(underlying);
    const db = getDb();
    const oldTicker = `${underlying}C10`;
    const newTicker = `${underlying}D20`;
    const sessions = businessDays("2099-09-16", 6);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const tieSession = sessions[1];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !tieSession || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${oldTicker}`,
        ticker: oldTicker,
        underlying,
        right: "call",
        strike: "29.95000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
      {
        isin: `ISIN-${newTicker}`,
        ticker: newTicker,
        underlying,
        right: "call",
        strike: "14.98000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
    ]);
    const tieAsOf = new Date(`${tieSession}T20:00:00.000Z`);
    pricedTickers.push(oldTicker, newTicker);
    for (const ticker of [oldTicker, newTicker]) {
      await db.insert(optionSeriesStrikes).values([
        { ticker, expiry, right: "call", strike: "29.95000000", asOf: tieAsOf },
        { ticker, expiry, right: "call", strike: "14.98000000", asOf: tieAsOf },
      ]);
    }

    await ensureMonthlyPartition(db, "option_daily_prices", tieSession);
    await db.insert(optionDailyPrices).values([
      {
        ticker: oldTicker,
        session: tieSession,
        asOf: tieAsOf,
        right: "call",
        strike: "29.95000000",
        expiry,
        average: "2.000000",
        close: "2.000000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: newTicker,
        session: tieSession,
        asOf: tieAsOf,
        right: "call",
        strike: "14.98000000",
        expiry,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const oldSeries = chain.find((candidate) => candidate.ticker === oldTicker);
    const newSeries = chain.find((candidate) => candidate.ticker === newTicker);
    expect(oldSeries?.lastPrice).toEqual({ value: "2.000000", session: tieSession });
    expect(oldSeries?.lastPriceStrike).toBeNull();
    expect(newSeries?.lastPrice).toEqual({ value: "1.000000", session: tieSession });
    expect(newSeries?.lastPriceStrike).toBeNull();
  });

  it("(c) excludes a price row from a previous listing cycle even though its strike coincides with the current cycle's", async () => {
    const underlying = uniqueTicker("STL");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}E10`;
    const sessions = businessDays("2099-10-05", 10);
    const currentSession = sessions[sessions.length - 1];
    const firstSession = sessions[0];
    const oldSession = sessions[1];
    const oldExpiry = sessions[2];
    const newExpiry = sessions[sessions.length - 1];
    if (!currentSession || !firstSession || !oldSession || !oldExpiry || !newExpiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    // Both cycles carry the same numeric strike on purpose: only the expiry
    // mismatch must exclude the old cycle's price, not a strike difference.
    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${optionTicker}-OLD`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: oldExpiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
      {
        isin: `ISIN-${optionTicker}-NEW`,
        ticker: optionTicker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: newExpiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      },
    ]);

    await ensureMonthlyPartition(db, "option_daily_prices", oldSession);
    pricedTickers.push(optionTicker);
    await db.insert(optionDailyPrices).values({
      ticker: optionTicker,
      session: oldSession,
      asOf: new Date(`${oldSession}T20:00:00.000Z`),
      right: "call",
      strike: "10.00000000",
      expiry: oldExpiry,
      average: "0.500000",
      close: "0.500000",
      trades: 1,
      tradedQuantity: 100,
    });

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.strike).toBe("10.00000000");
    expect(series?.expiry).toBe(newExpiry);
    expect(series?.lastPrice).toBeNull();
  });

  it("(e) still matches a price row at a strike the cycle later returned to (A to B to A, epoch as_of only moves backward via LEAST)", async () => {
    const underlying = uniqueTicker("REC");
    cleanupTickers.push(underlying);
    const db = getDb();
    const optionTicker = `${underlying}F10`;
    const isin = `ISIN-${optionTicker}`;
    const sessions = businessDays("2099-10-19", 8);
    const currentSession = sessions[sessions.length - 1];
    const sessionA = sessions[0];
    const sessionB = sessions[2];
    const sessionBackToA = sessions[4];
    const expiry = sessions[sessions.length - 1];
    if (!currentSession || !sessionA || !sessionB || !sessionBackToA || !expiry) {
      throw new Error("fixture setup failed");
    }
    await seedSessions(sessions);

    await upsertOptionSeries(db, new Date(`${sessionA}T13:00:00.000Z`), [
      seriesRow({
        ticker: optionTicker,
        isin,
        underlying,
        strike: "10.00000000",
        expiry,
        asOf: sessionA,
      }),
    ]);
    await ensureMonthlyPartition(db, "option_daily_prices", sessionA);
    pricedTickers.push(optionTicker);
    await upsertOptionDailyPrices(db, sessionA, new Date(`${sessionA}T20:00:00.000Z`), [
      priceRow({
        ticker: optionTicker,
        session: sessionA,
        strike: "10.00000000",
        expiry,
        close: "2.000000",
      }),
    ]);

    await upsertOptionSeries(db, new Date(`${sessionB}T13:00:00.000Z`), [
      seriesRow({
        ticker: optionTicker,
        isin,
        underlying,
        strike: "20.00000000",
        expiry,
        asOf: sessionB,
      }),
    ]);

    // Reverts to the original strike: the conflict target already carries
    // strike 10.00 from `sessionA`, so `LEAST` must keep that earlier as_of,
    // not move it forward to this later write.
    await upsertOptionSeries(db, new Date(`${sessionBackToA}T13:00:00.000Z`), [
      seriesRow({
        ticker: optionTicker,
        isin,
        underlying,
        strike: "10.00000000",
        expiry,
        asOf: sessionBackToA,
      }),
    ]);

    const epochs = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, optionTicker));
    expect(epochs).toHaveLength(2);
    const epochA = epochs.find((epoch) => epoch.strike === "10.00000000");
    expect(epochA?.asOf).toEqual(new Date(`${sessionA}T13:00:00.000Z`));

    const at = new Date(`${currentSession}T14:00:00.000Z`);
    const chain = await optionChainForUnderlying(db, underlying, currentSession, at);

    const series = chain.find((candidate) => candidate.ticker === optionTicker);
    expect(series?.strike).toBe("10.00000000");
    expect(series?.lastPrice).toEqual({ value: "2.000000", session: sessionA });
    expect(series?.lastPriceStrike).toBeNull();
  });
});

describe("optionSeriesInWindow", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
    }
  });

  async function seedSeries(underlying: string, label: string, expiry: string, asOf: string) {
    await getDb()
      .insert(optionSeries)
      .values({
        isin: `ISIN-${underlying}-${label}`,
        ticker: `${underlying}${label}`,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date(asOf),
      });
  }

  it("keeps series listed by the ceiling and expiring on or after the floor", async () => {
    const underlying = uniqueTicker("WIN");
    cleanupTickers.push(underlying);
    await seedSeries(underlying, "A", "2099-03-20", "2099-01-02T13:00:00.000Z");
    await seedSeries(underlying, "B", "2099-01-09", "2099-01-02T13:00:00.000Z");
    await seedSeries(underlying, "C", "2099-03-20", "2099-02-02T13:00:00.000Z");

    const result = await optionSeriesInWindow(
      getDb(),
      [underlying],
      { expiryFloor: "2099-01-10", asOfCeiling: new Date("2099-01-31T23:59:59.999Z") },
      10,
    );

    if (!result.ok) throw new Error("expected ok result");
    expect(result.rows.map((row) => row.ticker)).toEqual([`${underlying}A`]);
  });

  it("reports over_cap so the caller can tell a chain over it", async () => {
    const underlying = uniqueTicker("CAP");
    cleanupTickers.push(underlying);
    for (const label of ["A", "B", "C"]) {
      await seedSeries(underlying, label, "2099-03-20", "2099-01-02T13:00:00.000Z");
    }

    const result = await optionSeriesInWindow(
      getDb(),
      [underlying],
      { expiryFloor: "2099-01-10", asOfCeiling: new Date("2099-01-31T23:59:59.999Z") },
      1,
    );

    expect(result).toEqual({ ok: false, reason: "over_cap" });
  });
});

describe("optionPricesInSessionRange", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = cleanupTickers.splice(0);
    if (tickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    }
  });

  async function seedPrice(ticker: string, session: string): Promise<void> {
    const db = getDb();
    await ensureMonthlyPartition(db, "option_daily_prices", session);
    await db.insert(optionDailyPrices).values({
      ticker,
      session,
      asOf: new Date(`${session}T20:00:00.000Z`),
      right: "call",
      strike: "10.00000000",
      expiry: "2099-12-17",
      average: "1.000000",
      close: "1.000000",
      trades: 1,
      tradedQuantity: 100,
    });
  }

  it("includes a price on each edge of [fromSession, toSession] and excludes one just outside it", async () => {
    const ticker = uniqueTicker("RNG");
    cleanupTickers.push(ticker);
    await seedPrice(ticker, "2099-06-09");
    await seedPrice(ticker, "2099-06-10");
    await seedPrice(ticker, "2099-06-15");
    await seedPrice(ticker, "2099-06-16");

    const result = await optionPricesInSessionRange(
      getDb(),
      [ticker],
      { fromSession: "2099-06-10", toSession: "2099-06-15" },
      10,
    );

    if (!result.ok) throw new Error("expected ok result");
    expect(result.rows.map((row) => row.session).sort()).toEqual(["2099-06-10", "2099-06-15"]);
  });

  it("reports over_cap so the caller can tell a price volume over it", async () => {
    const ticker = uniqueTicker("CAP");
    cleanupTickers.push(ticker);
    await seedPrice(ticker, "2099-07-01");
    await seedPrice(ticker, "2099-07-02");
    await seedPrice(ticker, "2099-07-03");

    const result = await optionPricesInSessionRange(
      getDb(),
      [ticker],
      { fromSession: "2099-07-01", toSession: "2099-07-03" },
      1,
    );

    expect(result).toEqual({ ok: false, reason: "over_cap" });
  });
});

describe("optionSeriesForFills and latestExpiredTradedSeries", () => {
  const underlyings: string[] = [];
  const optionTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const seeded = underlyings.splice(0);
    const tickers = optionTickers.splice(0);
    if (seeded.length > 0) {
      await db.delete(optionSeries).where(inArray(optionSeries.underlying, seeded));
      await db.delete(candles).where(inArray(candles.ticker, seeded));
    }
    if (tickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    }
  });

  async function seedCycle(
    underlying: string,
    ticker: string,
    expiry: string,
    traded: { session: string; close: string } | null,
  ): Promise<void> {
    const db = getDb();
    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}-${expiry}`,
      ticker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry,
      style: "european",
      asOf: new Date("2098-01-02T13:00:00.000Z"),
    });
    if (traded) {
      await ensureMonthlyPartition(db, "option_daily_prices", traded.session);
      await db.insert(optionDailyPrices).values({
        ticker,
        session: traded.session,
        asOf: new Date(`${traded.session}T20:00:00.000Z`),
        right: "call",
        strike: "10.00000000",
        expiry,
        average: traded.close,
        close: traded.close,
        trades: 1,
        tradedQuantity: 100,
      });
    }
  }

  async function seedUnderlyingClose(underlying: string, session: string): Promise<void> {
    const db = getDb();
    await ensureMonthlyPartition(db, "candles", session);
    await db.insert(candles).values({
      ticker: underlying,
      timeframe: "1d",
      session,
      asOf: new Date(`${session}T21:00:00.000Z`),
      open: "10.000000",
      high: "10.000000",
      low: "10.000000",
      close: "10.000000",
      tradedQuantity: 100,
    });
  }

  it("resolves a reused ticker to the listing cycle the fill's session traded in", async () => {
    const underlying = uniqueTicker("CYC");
    underlyings.push(underlying);
    const ticker = `${underlying}A10`;
    await seedCycle(underlying, ticker, "2098-01-16", null);
    await seedCycle(underlying, ticker, "2098-02-20", null);

    const resolved = await optionSeriesForFills(getDb(), [
      { ticker, session: "2098-01-10" },
      { ticker, session: "2098-01-20" },
      { ticker, session: "2098-03-01" },
    ]);

    expect(resolved.get(seriesKey(ticker, "2098-01-10"))?.expiry).toBe("2098-01-16");
    expect(resolved.get(seriesKey(ticker, "2098-01-20"))?.expiry).toBe("2098-02-20");
    expect(resolved.has(seriesKey(ticker, "2098-03-01"))).toBe(false);
  });

  it("does not resolve a fill to a cycle listed after it traded", async () => {
    const underlying = uniqueTicker("LAT");
    underlyings.push(underlying);
    const ticker = `${underlying}A10`;
    optionTickers.push(ticker);
    await seedCycle(underlying, ticker, "2098-06-20", { session: "2098-05-04", close: "0.500000" });

    const resolved = await optionSeriesForFills(getDb(), [
      { ticker, session: "2097-10-10" },
      { ticker, session: "2098-05-04" },
    ]);

    expect(resolved.has(seriesKey(ticker, "2097-10-10"))).toBe(false);
    expect(resolved.get(seriesKey(ticker, "2098-05-04"))?.expiry).toBe("2098-06-20");
  });

  it("finds the latest expired series that traded and whose expiry close is ingested", async () => {
    const underlying = uniqueTicker("EXD");
    underlyings.push(underlying);
    const older = `${underlying}A10`;
    const newer = `${underlying}B10`;
    const noClose = `${underlying}C10`;
    optionTickers.push(older, newer, noClose);
    await seedCycle(underlying, older, "2098-01-16", { session: "2098-01-12", close: "0.500000" });
    await seedCycle(underlying, newer, "2098-02-20", { session: "2098-02-18", close: "0.700000" });
    await seedCycle(underlying, noClose, "2098-03-20", {
      session: "2098-03-18",
      close: "0.900000",
    });
    await seedUnderlyingClose(underlying, "2098-01-16");
    await seedUnderlyingClose(underlying, "2098-02-20");

    expect(await latestExpiredTradedSeries(getDb(), underlying)).toEqual({
      ticker: newer,
      session: "2098-02-18",
      expiry: "2098-02-20",
      close: "0.700000",
    });
  });

  it("returns null when the underlying has no expired traded series", async () => {
    expect(await latestExpiredTradedSeries(getDb(), uniqueTicker("NON"))).toBeNull();
  });
});

describe("searchOptionSeries and optionSeriesDetail", () => {
  const TODAY = "2099-06-15";
  const seededTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = seededTickers.splice(0);
    if (tickers.length > 0) {
      await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    }
  });

  async function seedSeries(
    ticker: string,
    cycle: { isin: string; expiry: string; strike: string; asOf: string; right?: string },
  ): Promise<void> {
    if (!seededTickers.includes(ticker)) {
      seededTickers.push(ticker);
    }
    await getDb()
      .insert(optionSeries)
      .values({
        isin: cycle.isin,
        ticker,
        underlying: "PETR4",
        right: cycle.right ?? "call",
        strike: cycle.strike,
        expiry: cycle.expiry,
        style: "european",
        asOf: new Date(cycle.asOf),
      });
  }

  async function seedPrice(
    ticker: string,
    session: string,
    expiry: string,
    close: string | null,
    trades: number,
  ): Promise<void> {
    await ensureMonthlyPartition(getDb(), "option_daily_prices", session);
    await getDb()
      .insert(optionDailyPrices)
      .values({
        ticker,
        session,
        asOf: new Date(`${session}T21:00:00.000Z`),
        right: "call",
        strike: "40",
        expiry,
        average: close,
        close,
        trades,
        tradedQuantity: trades * 100,
      });
  }

  function isin(): string {
    return `ZZ${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  }

  it("finds live series by ticker prefix, case-insensitively, and skips expired ones", async () => {
    const prefix = uniqueTicker("SR");
    const live = `${prefix}A40`;
    const expired = `${prefix}B40`;
    await seedSeries(live, {
      isin: isin(),
      expiry: "2099-07-17",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });
    await seedSeries(expired, {
      isin: isin(),
      expiry: "2099-06-14",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });

    const results = await searchOptionSeries(getDb(), prefix.toLowerCase(), TODAY, 20);

    expect(results).toEqual([
      {
        ticker: live,
        underlying: "PETR4",
        right: "call",
        strike: "40.00000000",
        expiry: "2099-07-17",
      },
    ]);
  });

  it("keeps a series expiring today", async () => {
    const prefix = uniqueTicker("ST");
    const ticker = `${prefix}C40`;
    await seedSeries(ticker, {
      isin: isin(),
      expiry: TODAY,
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });

    const results = await searchOptionSeries(getDb(), prefix, TODAY, 20);

    expect(results.map((row) => row.ticker)).toEqual([ticker]);
  });

  it("lists a reused ticker once, as its nearest live cycle", async () => {
    const prefix = uniqueTicker("SU");
    const ticker = `${prefix}D40`;
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2098-07-17",
      strike: "38",
      asOf: "2098-01-02T00:00:00Z",
    });
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2100-07-16",
      strike: "44",
      asOf: "2099-03-02T00:00:00Z",
    });
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2099-07-17",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });

    const results = await searchOptionSeries(getDb(), prefix, TODAY, 20);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ticker, expiry: "2099-07-17", strike: "40.00000000" });
  });

  it("caps the result count and orders by ticker", async () => {
    const prefix = uniqueTicker("SV");
    const tickers = [`${prefix}C`, `${prefix}A`, `${prefix}B`];
    for (const ticker of tickers) {
      await seedSeries(ticker, {
        isin: isin(),
        expiry: "2099-07-17",
        strike: "40",
        asOf: "2099-01-02T00:00:00Z",
      });
    }

    const results = await searchOptionSeries(getDb(), prefix, TODAY, 2);

    expect(results.map((row) => row.ticker)).toEqual([`${prefix}A`, `${prefix}B`]);
  });

  it("returns nothing for a query carrying a LIKE wildcard", async () => {
    const prefix = uniqueTicker("SW");
    await seedSeries(`${prefix}A`, {
      isin: isin(),
      expiry: "2099-07-17",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });

    expect(await searchOptionSeries(getDb(), "%", TODAY, 20)).toEqual([]);
    expect(await searchOptionSeries(getDb(), `${prefix.slice(0, 3)}_`, TODAY, 20)).toEqual([]);
  });

  it("opens the same live cycle the search lists, with only that cycle's prices, newest first", async () => {
    const prefix = uniqueTicker("DA");
    const ticker = `${prefix}E40`;
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2098-07-17",
      strike: "38",
      asOf: "2098-01-02T00:00:00Z",
    });
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2099-07-17",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });
    await seedPrice(ticker, "2098-07-10", "2098-07-17", "9.99", 3);
    await seedPrice(ticker, "2099-06-10", "2099-07-17", "1.25", 12);
    await seedPrice(ticker, "2099-06-11", "2099-07-17", null, 0);
    await seedPrice(ticker, "2099-06-12", "2099-07-17", "1.40", 7);

    const detail = await optionSeriesDetail(getDb(), ticker, TODAY, 2);

    expect(detail).toEqual({
      ticker,
      underlying: "PETR4",
      right: "call",
      strike: "40.00000000",
      expiry: "2099-07-17",
      style: "european",
      expired: false,
      lastTrade: { session: "2099-06-12", close: "1.400000" },
      prices: [
        { session: "2099-06-12", close: "1.400000", average: "1.400000", trades: 7 },
        { session: "2099-06-11", close: null, average: null, trades: 0 },
      ],
    });
  });

  it("finds the last trade even when it is older than the price rows shown", async () => {
    const prefix = uniqueTicker("DC");
    const ticker = `${prefix}G40`;
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2099-07-17",
      strike: "40",
      asOf: "2099-01-02T00:00:00Z",
    });
    await seedPrice(ticker, "2099-06-08", "2099-07-17", "0.35", 2);
    await seedPrice(ticker, "2099-06-11", "2099-07-17", null, 0);
    await seedPrice(ticker, "2099-06-12", "2099-07-17", null, 0);

    const detail = await optionSeriesDetail(getDb(), ticker, TODAY, 2);

    expect(detail?.prices.map((price) => price.close)).toEqual([null, null]);
    expect(detail?.lastTrade).toEqual({ session: "2099-06-08", close: "0.350000" });
  });

  it("falls back to the most recently expired cycle when none is live", async () => {
    const prefix = uniqueTicker("DB");
    const ticker = `${prefix}F40`;
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2097-07-17",
      strike: "36",
      asOf: "2097-01-02T00:00:00Z",
    });
    await seedSeries(ticker, {
      isin: isin(),
      expiry: "2098-07-17",
      strike: "38",
      asOf: "2098-01-02T00:00:00Z",
    });

    const detail = await optionSeriesDetail(getDb(), ticker, TODAY, 20);

    expect(detail).toMatchObject({
      expiry: "2098-07-17",
      strike: "38.00000000",
      expired: true,
      lastTrade: null,
      prices: [],
    });
  });

  it("is null for a ticker the registry has never listed", async () => {
    expect(await optionSeriesDetail(getDb(), uniqueTicker("NO"), TODAY, 20)).toBeNull();
  });
});
