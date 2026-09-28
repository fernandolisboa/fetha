import { and, asc, eq, gte, lte } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles, optionDailyPrices, tradingSessions } from "../schema";

import { deleteUnlistedTradingSessions, upsertTradingSessions } from "./calendar-repository";
import { ensureMonthlyPartition } from "./partitions";

const YEAR = 2031;

function session(date: string): { date: string; open: string; close: string } {
  return { date, open: `${date}T13:00:00.000Z`, close: `${date}T20:00:00.000Z` };
}

async function stored(from: string, to: string): Promise<Array<{ date: string; asOf: Date }>> {
  return getDb()
    .select({ date: tradingSessions.date, asOf: tradingSessions.asOf })
    .from(tradingSessions)
    .where(and(gte(tradingSessions.date, from), lte(tradingSessions.date, to)))
    .orderBy(asc(tradingSessions.date));
}

const CANDLE_TICKER = "ZZDU3";
const OPTION_TICKER = "ZZDUW999";

async function insertCandle(session: string): Promise<void> {
  const db = getDb();
  await ensureMonthlyPartition(db, "candles", session);
  await db.insert(candles).values({
    ticker: CANDLE_TICKER,
    timeframe: "1d",
    session,
    asOf: new Date(`${session}T22:00:00.000Z`),
    open: "10",
    high: "10",
    low: "10",
    close: "10",
    tradedQuantity: 1,
  });
}

async function insertOptionPrice(session: string): Promise<void> {
  const db = getDb();
  await ensureMonthlyPartition(db, "option_daily_prices", session);
  await db.insert(optionDailyPrices).values({
    ticker: OPTION_TICKER,
    session,
    asOf: new Date(`${session}T22:00:00.000Z`),
    right: "call",
    strike: "10",
    expiry: "2031-12-19",
    average: "1",
    close: "1",
    factor: "1",
    trades: 1,
    tradedQuantity: 1,
  });
}

afterEach(async () => {
  await getDb().delete(candles).where(eq(candles.ticker, CANDLE_TICKER));
  await getDb().delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, OPTION_TICKER));
  await getDb()
    .delete(tradingSessions)
    .where(and(gte(tradingSessions.date, "2030-12-01"), lte(tradingSessions.date, "2032-01-31")));
});

describe("deleteUnlistedTradingSessions", () => {
  it("deletes a date the year's source no longer lists and re-stamps every surviving session", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [
      session("2030-12-30"),
      session("2031-03-03"),
      session("2031-03-04"),
      session("2031-03-05"),
    ]);
    const before = await stored("2030-12-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [
      session("2031-03-03"),
      session("2031-03-05"),
    ]);

    const after = await stored("2030-12-01", "2031-12-31");
    expect(result).toEqual({ removed: 1 });
    expect(after.map((row) => row.date)).toEqual(["2030-12-30", "2031-03-03", "2031-03-05"]);
    for (const row of after) {
      const previous = before.find((candidate) => candidate.date === row.date);
      expect(row.asOf.getTime()).toBeGreaterThan(previous?.asOf.getTime() ?? Infinity);
    }
  });

  it("changes nothing when the source still lists every stored date of the year", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-03-03"), session("2031-03-04")]);
    const before = await stored("2031-01-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [
      session("2031-03-03"),
      session("2031-03-04"),
      session("2031-03-05"),
    ]);

    expect(result).toEqual({ removed: 0 });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });

  it("never deletes a session outside the year the source covers", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [
      session("2030-12-31"),
      session("2031-06-02"),
      session("2032-01-02"),
    ]);

    await deleteUnlistedTradingSessions(db, YEAR, [session("2031-06-02")]);

    expect((await stored("2030-12-01", "2032-01-31")).map((row) => row.date)).toEqual([
      "2030-12-31",
      "2031-06-02",
      "2032-01-02",
    ]);
  });

  it("does nothing for an empty source rather than wiping the year", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-06-02")]);

    expect(await deleteUnlistedTradingSessions(db, YEAR, [])).toEqual({ removed: 0 });
    expect((await stored("2031-01-01", "2031-12-31")).map((row) => row.date)).toEqual([
      "2031-06-02",
    ]);
  });

  it("blocks the whole year's delete when a candle exists on a date the source no longer lists", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-03-03"), session("2031-03-04")]);
    await insertCandle("2031-03-04");
    const before = await stored("2031-01-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [session("2031-03-03")]);

    expect(result).toEqual({ blocked: ["2031-03-04"] });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });

  it("blocks the whole year's delete when an option price exists on a date the source no longer lists", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-03-03"), session("2031-03-04")]);
    await insertOptionPrice("2031-03-04");
    const before = await stored("2031-01-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [session("2031-03-03")]);

    expect(result).toEqual({ blocked: ["2031-03-04"] });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });

  it("keeps a candidate with no market data too when another candidate of the same year is blocked", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [
      session("2031-03-03"),
      session("2031-03-04"),
      session("2031-03-05"),
    ]);
    await insertCandle("2031-03-04");
    const before = await stored("2031-01-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [session("2031-03-03")]);

    expect(result).toEqual({ blocked: ["2031-03-04"] });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });
});
