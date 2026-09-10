import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { optionSeries, tradingSessions } from "@/db/schema/market-data";

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

describe("optionChainForUnderlying", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    for (const ticker of cleanupTickers.splice(0)) {
      await db.delete(optionSeries).where(eq(optionSeries.underlying, ticker));
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
});
