import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { loadMigrationStatements } from "@/db/test/migration-sql";

import {
  corporateActionFactors,
  optionDailyPrices,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "../schema";

import { cotahistOptionRowSchema } from "../adapters/cotahist/schema";

import {
  boundOptionStrikeEpochs,
  optionSeriesForUnderlyingAt,
  upsertOptionDailyPrices,
} from "./option-repository";
import { ensureMonthlyPartition } from "./partitions";

const SESSION_OPEN_UTC = "13:00:00.000Z";
const SESSION_CLOSE_UTC = "20:00:00.000Z";
const EXPIRY = "2099-06-16";

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

function open(session: string): Date {
  return new Date(`${session}T${SESSION_OPEN_UTC}`);
}

function close(session: string): Date {
  return new Date(`${session}T${SESSION_CLOSE_UTC}`);
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

function at(sessions: readonly string[], index: number): string {
  const session = sessions[index];
  if (!session) throw new Error(`fixture has no session ${String(index)}`);
  return session;
}

const cleanupUnderlyings: string[] = [];
const cleanupTickers: string[] = [];
const cleanupSessions: string[] = [];

afterEach(async () => {
  const db = getDb();
  const tickers = cleanupTickers.splice(0);
  if (tickers.length > 0) {
    await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, tickers));
    await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
  }
  const underlyings = cleanupUnderlyings.splice(0);
  if (underlyings.length > 0) {
    await db
      .delete(corporateActionFactors)
      .where(inArray(corporateActionFactors.ticker, underlyings));
  }
  const sessions = cleanupSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  }
});

// A 2-for-1 split of `underlying` ex-dated on `sessions[5]`, one call series
// listed on it, ten sessions of calendar.
async function splitFixture(label: string) {
  const db = getDb();
  const underlying = uniqueTicker(label);
  const ticker = `${underlying}B310`;
  cleanupUnderlyings.push(underlying);
  cleanupTickers.push(ticker);
  const sessions = businessDays("2099-03-02", 10);
  cleanupSessions.push(...sessions);
  await db
    .insert(tradingSessions)
    .values(sessions.map((date) => ({ date, open: open(date), close: close(date) })))
    .onConflictDoNothing();
  for (const session of sessions) {
    await ensureMonthlyPartition(db, "option_daily_prices", session);
  }
  const exDate = at(sessions, 5);

  await db.insert(optionSeries).values({
    isin: `ISIN-${ticker}`,
    ticker,
    underlying,
    right: "call",
    strike: "14.98000000",
    expiry: EXPIRY,
    style: "european",
    asOf: open(at(sessions, 0)),
  });

  return {
    underlying,
    ticker,
    sessions,
    exDate,
    async recordFactor(factor: string, exDateOverride = exDate) {
      await db
        .insert(corporateActionFactors)
        .values({ ticker: underlying, exDate: exDateOverride, asOf: open(exDateOverride), factor })
        .onConflictDoUpdate({
          target: [corporateActionFactors.ticker, corporateActionFactors.exDate],
          set: { factor: sql`excluded.factor` },
        });
    },
    async epoch(strike: string, asOf: Date) {
      await db.insert(optionSeriesStrikes).values({
        ticker,
        expiry: EXPIRY,
        right: "call",
        strike,
        asOf,
      });
    },
    async trade(session: string, strike: string) {
      await db.insert(optionDailyPrices).values({
        ticker,
        session,
        asOf: close(session),
        right: "call",
        strike,
        expiry: EXPIRY,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      });
    },
    async notBefore(strike: string): Promise<Date | null | undefined> {
      const [row] = await db
        .select({ notBefore: optionSeriesStrikes.notBefore })
        .from(optionSeriesStrikes)
        .where(and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, strike)));
      return row?.notBefore;
    },
    async visibleStrikesAt(instant: Date): Promise<{ strike: string; asOf: Date }[]> {
      const rows = await optionSeriesForUnderlyingAt(db, underlying, instant, undefined);
      return rows
        .map((row) => ({ strike: row.strike, asOf: row.asOf }))
        .sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
    },
  };
}

describe("boundOptionStrikeEpochs", () => {
  it("re-dates a transition the backfill dated before the split to the ex-date's open", async () => {
    const db = getDb();
    const f = await splitFixture("BTR");
    await f.trade(at(f.sessions, 1), "29.95000000");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    // Backfill step 3: the session after the last old-strike trade, three sessions early.
    await f.epoch("14.98000000", open(at(f.sessions, 2)));
    await f.trade(f.exDate, "14.98000000");
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(1);
    expect(await f.notBefore("14.98000000")).toEqual(open(f.exDate));
    expect(await f.notBefore("29.95000000")).toBeNull();

    const beforeEvent = await f.visibleStrikesAt(close(at(f.sessions, 4)));
    expect(beforeEvent.map((row) => row.strike)).toEqual(["29.95000000"]);
    const onEvent = await f.visibleStrikesAt(close(f.exDate));
    expect(onEvent).toEqual([
      { strike: "29.95000000", asOf: close(at(f.sessions, 1)) },
      { strike: "14.98000000", asOf: open(f.exDate) },
    ]);
  });

  it("re-dates a lone registry epoch that only ever traded after the ex-date", async () => {
    const db = getDb();
    const f = await splitFixture("BLN");
    // Backfill step 2: the registry's current strike under its first sighting.
    await f.epoch("14.98000000", open(at(f.sessions, 0)));
    await f.trade(at(f.sessions, 7), "14.98000000");
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(1);
    expect(await f.notBefore("14.98000000")).toEqual(open(f.exDate));
    expect(await f.visibleStrikesAt(close(at(f.sessions, 4)))).toEqual([]);
    expect(await f.visibleStrikesAt(open(f.exDate))).toEqual([
      { strike: "14.98000000", asOf: open(f.exDate) },
    ]);
  });

  it("leaves a lone epoch alone when the cycle traded before the ex-date", async () => {
    const db = getDb();
    const f = await splitFixture("BPR");
    await f.epoch("14.98000000", close(at(f.sessions, 1)));
    await f.trade(at(f.sessions, 1), "14.98000000");
    await f.trade(at(f.sessions, 7), "14.98000000");
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
    expect(await f.notBefore("14.98000000")).toBeNull();
  });

  it("leaves a lone epoch alone when the cycle never traded at all", async () => {
    const db = getDb();
    const f = await splitFixture("BNT");
    await f.epoch("14.98000000", open(at(f.sessions, 0)));
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
    expect(await f.notBefore("14.98000000")).toBeNull();
  });

  it("leaves a transition the factor does not explain alone (a dividend re-strike)", async () => {
    const db = getDb();
    const f = await splitFixture("BDV");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("29.10000000", open(at(f.sessions, 2)));
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
    expect(await f.notBefore("29.10000000")).toBeNull();
  });

  it("leaves a transition alone when a later epoch already sits before the ex-date", async () => {
    const db = getDb();
    const f = await splitFixture("BNX");
    await f.epoch("29.95000000", close(at(f.sessions, 0)));
    await f.epoch("14.98000000", open(at(f.sessions, 1)));
    await f.epoch("14.50000000", open(at(f.sessions, 3)));
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
    expect(await f.notBefore("14.98000000")).toBeNull();
  });

  it("leaves an epoch dated on or after the ex-date's open alone", async () => {
    const db = getDb();
    const f = await splitFixture("BLT");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("14.98000000", close(f.exDate));
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
    expect(await f.notBefore("14.98000000")).toBeNull();
  });

  it("ignores a factor ex-dated after the series' expiry", async () => {
    const db = getDb();
    const f = await splitFixture("BEX");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("14.98000000", open(at(f.sessions, 2)));
    const afterExpiry = "2099-06-17";
    cleanupSessions.push(afterExpiry);
    await db
      .insert(tradingSessions)
      .values({ date: afterExpiry, open: open(afterExpiry), close: close(afterExpiry) })
      .onConflictDoNothing();
    await f.recordFactor("0.50000000", afterExpiry);

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);
  });

  it("clears the bound once the factor is neutralized, and is idempotent", async () => {
    const db = getDb();
    const f = await splitFixture("BNU");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("14.98000000", open(at(f.sessions, 2)));
    await f.recordFactor("0.50000000");

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(1);
    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(0);

    await f.recordFactor("1.00000000");
    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(1);
    expect(await f.notBefore("14.98000000")).toBeNull();
    expect(await f.visibleStrikesAt(close(at(f.sessions, 2)))).toEqual([
      { strike: "29.95000000", asOf: close(at(f.sessions, 1)) },
      { strike: "14.98000000", asOf: open(at(f.sessions, 2)) },
    ]);
  });

  it("only touches the underlying it is given", async () => {
    const db = getDb();
    const f = await splitFixture("BON");
    const other = await splitFixture("BOT");
    for (const fixture of [f, other]) {
      await fixture.epoch("29.95000000", close(at(fixture.sessions, 1)));
      await fixture.epoch("14.98000000", open(at(fixture.sessions, 2)));
      await fixture.recordFactor("0.50000000");
    }

    expect(await boundOptionStrikeEpochs(db, f.underlying)).toBe(1);
    expect(await other.notBefore("14.98000000")).toBeNull();
  });

  it("a live writer moving as_of earlier keeps the bound", async () => {
    const db = getDb();
    const f = await splitFixture("BLW");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("14.98000000", open(at(f.sessions, 2)));
    await f.recordFactor("0.50000000");
    await boundOptionStrikeEpochs(db, f.underlying);

    const session = at(f.sessions, 2);
    const earlier = new Date(`${session}T12:00:00.000Z`);
    await upsertOptionDailyPrices(db, session, earlier, [
      cotahistOptionRowSchema.parse({
        kind: "option",
        session,
        ticker: f.ticker,
        right: "call",
        strike: "14.98000000",
        expiry: EXPIRY,
        factor: "1.000000",
        open: "1.000000",
        high: "1.000000",
        low: "1.000000",
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      }),
    ]);

    const [row] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(
          eq(optionSeriesStrikes.ticker, f.ticker),
          eq(optionSeriesStrikes.strike, "14.98000000"),
        ),
      );
    expect(row?.asOf).toEqual(earlier);
    expect(row?.notBefore).toEqual(open(f.exDate));
  });
});

describe("migration 0045", () => {
  it("bounds every underlying that has a recorded factor", async () => {
    const db = getDb();
    const f = await splitFixture("BMG");
    await f.epoch("29.95000000", close(at(f.sessions, 1)));
    await f.epoch("14.98000000", open(at(f.sessions, 2)));
    await f.recordFactor("0.50000000");

    const statements = loadMigrationStatements("0045_strike_epoch_not_before");
    const backfill = statements.at(-1) ?? "";
    expect(backfill.toUpperCase().startsWith("SELECT BOUND_OPTION_STRIKE_EPOCHS")).toBe(true);
    await db.execute(sql.raw(backfill));

    expect(await f.notBefore("14.98000000")).toEqual(open(f.exDate));
  });
});
