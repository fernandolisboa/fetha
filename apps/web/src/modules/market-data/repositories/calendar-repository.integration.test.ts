import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles, optionDailyPrices, tradingSessions } from "../schema";

import { withSourceLock } from "./advisory-lock";
import { deleteUnlistedTradingSessions, upsertTradingSessions } from "./calendar-repository";
import { ensureMonthlyPartition } from "./partitions";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
    expect(result).toEqual({ kind: "removed", removed: 1 });
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

    expect(result).toEqual({ kind: "removed", removed: 0 });
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

    expect(await deleteUnlistedTradingSessions(db, YEAR, [])).toEqual({
      kind: "removed",
      removed: 0,
    });
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

    expect(result).toEqual({ kind: "blocked", dates: ["2031-03-04"] });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });

  it("blocks the whole year's delete when an option price exists on a date the source no longer lists", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-03-03"), session("2031-03-04")]);
    await insertOptionPrice("2031-03-04");
    const before = await stored("2031-01-01", "2031-12-31");

    const result = await deleteUnlistedTradingSessions(db, YEAR, [session("2031-03-03")]);

    expect(result).toEqual({ kind: "blocked", dates: ["2031-03-04"] });
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

    expect(result).toEqual({ kind: "blocked", dates: ["2031-03-04"] });
    expect(await stored("2031-01-01", "2031-12-31")).toEqual(before);
  });

  it("under the shared cotahist lock, a candle write already holding the lock is not missed", async () => {
    const db = getDb();
    await upsertTradingSessions(db, [session("2031-03-03"), session("2031-03-04")]);
    await ensureMonthlyPartition(db, "candles", "2031-03-04");

    const writerHasLock = deferred<undefined>();
    const writer = withSourceLock(db, "cotahist", async (tx) => {
      writerHasLock.resolve(undefined);
      await new Promise((r) => setTimeout(r, 150));
      await tx.insert(candles).values({
        ticker: CANDLE_TICKER,
        timeframe: "1d",
        session: "2031-03-04",
        asOf: new Date("2031-03-04T22:00:00.000Z"),
        open: "10",
        high: "10",
        low: "10",
        close: "10",
        tradedQuantity: 1,
      });
    });

    await writerHasLock.promise;
    const deleter = withSourceLock(db, "cotahist", (tx) =>
      deleteUnlistedTradingSessions(tx, YEAR, [session("2031-03-03")]),
    );

    const [, result] = await Promise.all([writer, deleter]);

    expect(result).toEqual({ kind: "blocked", dates: ["2031-03-04"] });
  });
});

describe("the delete's market-data existence probes", () => {
  const PROBED = ["2031-03-12", "2031-04-15"] as const;

  // The same correlated shape `deleteUnlistedTradingSessions` issues, where
  // the session is not a plan-time constant. Tiny test partitions always
  // favour a sequential scan, so the planner is told to avoid one: the
  // assertion is that an index leading with `session` exists to serve the
  // probe, not the cost model's choice at test volume.
  async function probePlan(table: "candles" | "option_daily_prices"): Promise<string> {
    return getDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const result = await tx.execute<{ "QUERY PLAN": string }>(
        sql`explain with candidates as materialized (
            select ${PROBED[0]}::date as date union all select ${PROBED[1]}::date
          )
          select date from candidates
          where exists (select 1 from ${sql.identifier(table)} where session = candidates.date)`,
      );
      return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
    });
  }

  it("serves the candles probe from the session index", async () => {
    for (const date of PROBED) {
      await ensureMonthlyPartition(getDb(), "candles", date);
    }
    expect(await probePlan("candles")).toMatch(
      /Index (?:Only )?Scan (?:using|on) candles_\S*session_idx/,
    );
  });

  it("serves the option prices probe from the session index", async () => {
    for (const date of PROBED) {
      await ensureMonthlyPartition(getDb(), "option_daily_prices", date);
    }
    expect(await probePlan("option_daily_prices")).toMatch(
      /Index (?:Only )?Scan (?:using|on) option_daily_prices_\S*session_idx/,
    );
  });
});
