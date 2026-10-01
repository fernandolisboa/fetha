import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { instantSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { loadMigrationStatements } from "@/db/test/migration-sql";

import { instrumentOptionSeriesSchema } from "../adapters/b3-instruments/schema";
import { cotahistOptionRowSchema } from "../adapters/cotahist/schema";
import { buildOperationMarketView, loadMarketView } from "../market-view";
import { optionDailyPrices, optionSeries, optionSeriesStrikes, tradingSessions } from "../schema";

import {
  optionSeriesInWindow,
  upsertOptionDailyPrices,
  upsertOptionSeries,
} from "./option-repository";
import { ensureMonthlyPartition } from "./partitions";

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

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

function latestEpoch<T extends { ticker: string; asOf: string }>(
  series: readonly T[],
  ticker: string,
): T | undefined {
  return series
    .filter((row) => row.ticker === ticker)
    .reduce<T | undefined>(
      (latest, row) => (!latest || row.asOf > latest.asOf ? row : latest),
      undefined,
    );
}

function seriesRow(fields: {
  isin: string;
  ticker: string;
  strike: string;
  expiry: string;
  asOf: string;
}) {
  return instrumentOptionSeriesSchema.parse({
    ticker: fields.ticker,
    isin: fields.isin,
    underlying: "BBAS3",
    right: "call",
    strike: fields.strike,
    expiry: fields.expiry,
    style: "european",
    asOf: fields.asOf,
  });
}

function optionRow(fields: { ticker: string; session: string; strike: string; expiry: string }) {
  return cotahistOptionRowSchema.parse({
    kind: "option",
    session: fields.session,
    ticker: fields.ticker,
    right: "call",
    strike: fields.strike,
    expiry: fields.expiry,
    factor: "1.000000",
    open: "1.000000",
    high: "1.000000",
    low: "1.000000",
    average: "1.000000",
    close: "1.000000",
    trades: 1,
    tradedQuantity: 100,
  });
}

describe("writers upsert a strike epoch alongside the row they write", () => {
  const cleanupTickers: string[] = [];
  const cleanupIsins: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = cleanupTickers.splice(0);
    const isins = cleanupIsins.splice(0);
    if (tickers.length > 0) {
      await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, tickers));
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    }
    if (isins.length > 0) {
      await db.delete(optionSeries).where(inArray(optionSeries.isin, isins));
    }
  });

  it("upsertOptionSeries records the epoch's first-seen asOf and never advances it on an older snapshot", async () => {
    const db = getDb();
    const ticker = uniqueTicker("EPS");
    const isin = `ISIN-${ticker}`;
    cleanupTickers.push(ticker);
    cleanupIsins.push(isin);

    await upsertOptionSeries(db, new Date("2099-03-10T13:00:00.000Z"), [
      seriesRow({ isin, ticker, strike: "29.95000000", expiry: "2099-06-16", asOf: "2099-03-10" }),
    ]);

    const [epoch] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "29.95000000")),
      );
    expect(epoch?.asOf).toEqual(new Date("2099-03-10T13:00:00.000Z"));

    await upsertOptionSeries(db, new Date("2099-03-05T13:00:00.000Z"), [
      seriesRow({ isin, ticker, strike: "29.95000000", expiry: "2099-06-16", asOf: "2099-03-05" }),
    ]);

    const [afterOlderRerun] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "29.95000000")),
      );
    expect(afterOlderRerun?.asOf).toEqual(new Date("2099-03-05T13:00:00.000Z"));

    await upsertOptionSeries(db, new Date("2099-03-20T13:00:00.000Z"), [
      seriesRow({ isin, ticker, strike: "29.95000000", expiry: "2099-06-16", asOf: "2099-03-20" }),
    ]);

    const [afterNewerRerun] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "29.95000000")),
      );
    expect(afterNewerRerun?.asOf).toEqual(new Date("2099-03-05T13:00:00.000Z"));
  });

  it("upsertOptionSeries does not throw when two ISINs on one (ticker, expiry, right) carry the same strike in different textual forms", async () => {
    const db = getDb();
    const ticker = uniqueTicker("ETF");
    const isinA = `ISIN-${ticker}-A`;
    const isinB = `ISIN-${ticker}-B`;
    cleanupTickers.push(ticker);
    cleanupIsins.push(isinA, isinB);

    await expect(
      upsertOptionSeries(db, new Date("2099-03-10T13:00:00.000Z"), [
        seriesRow({
          isin: isinA,
          ticker,
          strike: "14.98",
          expiry: "2099-06-16",
          asOf: "2099-03-10",
        }),
        seriesRow({
          isin: isinB,
          ticker,
          strike: "14.980",
          expiry: "2099-06-16",
          asOf: "2099-03-10",
        }),
      ]),
    ).resolves.not.toThrow();

    const epochs = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));
    expect(epochs).toHaveLength(1);
    expect(epochs[0]?.strike).toBe("14.98000000");
  });

  it("upsertOptionDailyPrices records a new epoch per strike change and keeps an epoch's asOf monotonic on re-ingestion", async () => {
    const db = getDb();
    const ticker = uniqueTicker("EPP");
    cleanupTickers.push(ticker);

    const sessionD1 = "2099-04-15";
    const sessionD = "2099-04-16";
    await ensureMonthlyPartition(db, "option_daily_prices", sessionD1);
    await ensureMonthlyPartition(db, "option_daily_prices", sessionD);

    await upsertOptionDailyPrices(db, sessionD1, new Date(`${sessionD1}T20:00:00.000Z`), [
      optionRow({ ticker, session: sessionD1, strike: "29.95000000", expiry: "2099-06-16" }),
    ]);
    await upsertOptionDailyPrices(db, sessionD, new Date(`${sessionD}T20:00:00.000Z`), [
      optionRow({ ticker, session: sessionD, strike: "14.98000000", expiry: "2099-06-16" }),
    ]);

    const epochs = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));

    expect(epochs).toHaveLength(2);
    const byStrike = new Map(epochs.map((row) => [row.strike, row.asOf]));
    expect(byStrike.get("29.95000000")).toEqual(new Date(`${sessionD1}T20:00:00.000Z`));
    expect(byStrike.get("14.98000000")).toEqual(new Date(`${sessionD}T20:00:00.000Z`));

    // Re-ingesting the older session again must not move that epoch's asOf forward.
    await upsertOptionDailyPrices(db, sessionD1, new Date(`${sessionD1}T21:00:00.000Z`), [
      optionRow({ ticker, session: sessionD1, strike: "29.95000000", expiry: "2099-06-16" }),
    ]);
    const [unchanged] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "29.95000000")),
      );
    expect(unchanged?.asOf).toEqual(new Date(`${sessionD1}T20:00:00.000Z`));
  });
});

describe("optionSeriesInWindow ticker cap counts distinct tickers, not epoch rows", () => {
  const cleanupTickers: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = cleanupTickers.splice(0);
    if (tickers.length > 0) {
      await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, tickers));
      await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
    }
  });

  it("does not refuse a single series with several strike epochs even at cap 1", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BBA");
    const ticker = `${underlying}B310`;
    cleanupTickers.push(ticker);

    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike: "14.98000000",
      expiry: "2099-06-16",
      style: "european",
      asOf: new Date("2099-04-16T13:00:00.000Z"),
    });
    await db.insert(optionSeriesStrikes).values([
      {
        ticker,
        expiry: "2099-06-16",
        right: "call",
        strike: "29.95000000",
        asOf: new Date("2099-01-02T13:00:00.000Z"),
      },
      {
        ticker,
        expiry: "2099-06-16",
        right: "call",
        strike: "14.98000000",
        asOf: new Date("2099-04-16T20:00:00.000Z"),
      },
    ]);

    const result = await optionSeriesInWindow(
      db,
      [underlying],
      { expiryFloor: "2099-01-01", asOfCeiling: new Date("2099-12-31T23:59:59.999Z") },
      1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.ticker))).toEqual(new Set([ticker]));
  });

  it("still reports over_cap once distinct tickers exceed it", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BBB");
    const tickerA = `${underlying}A`;
    const tickerB = `${underlying}B`;
    cleanupTickers.push(tickerA, tickerB);

    for (const ticker of [tickerA, tickerB]) {
      await db.insert(optionSeries).values({
        isin: `ISIN-${ticker}`,
        ticker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry: "2099-06-16",
        style: "european",
        asOf: new Date("2099-01-02T13:00:00.000Z"),
      });
    }

    const result = await optionSeriesInWindow(
      db,
      [underlying],
      { expiryFloor: "2099-01-01", asOfCeiling: new Date("2099-12-31T23:59:59.999Z") },
      1,
    );

    expect(result).toEqual({ ok: false, reason: "over_cap" });
  });
});

describe("migration 0033 backfill", () => {
  const cleanupTickers: string[] = [];
  const cleanupSessionDates: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const tickers = cleanupTickers.splice(0);
    if (tickers.length > 0) {
      await db.delete(optionSeriesStrikes).where(inArray(optionSeriesStrikes.ticker, tickers));
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
      await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
    }
    const dates = cleanupSessionDates.splice(0);
    if (dates.length > 0) {
      await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
    }
  });

  async function runBackfillStatements(): Promise<void> {
    const db = getDb();
    const statements = loadMigrationStatements("0033_option_series_strikes").filter(
      (statement) =>
        statement.toUpperCase().startsWith("INSERT") || statement.toUpperCase().startsWith("WITH"),
    );
    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }
  }

  it("resolves 29.95 through D-1 and 14.98 from D, in both buildOperationMarketView and loadMarketView, without leaking the post-split strike backward (the fixed regression)", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BBS");
    const ticker = `${underlying}B310`;
    cleanupTickers.push(ticker);
    const expiry = "2099-06-16";

    const sessions = businessDays("2099-03-01", 8);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);
    const firstSession = sessions[0] ?? "";
    const lastSession = sessions.at(-1) ?? "";
    const sessionDMinus1 = sessions[3] ?? "";
    const sessionD = sessions[4] ?? "";

    for (const session of [sessionDMinus1, sessionD]) {
      await ensureMonthlyPartition(db, "option_daily_prices", session);
    }
    await db.insert(optionDailyPrices).values([
      {
        ticker,
        session: sessionDMinus1,
        asOf: new Date(`${sessionDMinus1}T${SESSION_CLOSE_UTC}`),
        right: "call",
        strike: "29.95000000",
        expiry,
        average: "2.000000",
        close: "2.000000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker,
        session: sessionD,
        asOf: new Date(`${sessionD}T${SESSION_CLOSE_UTC}`),
        right: "call",
        strike: "14.98000000",
        expiry,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    // The registry already shows the post-split strike, but its own as_of
    // (the row's earliest sighting, ADR-0017) predates the first trade.
    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike: "14.98000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
    });

    await runBackfillStatements();

    const beforeSplit = await buildOperationMarketView(
      db,
      tickerSchema.parse(underlying),
      instantSchema.parse(`${sessionDMinus1}T${SESSION_CLOSE_UTC}`),
    );
    const seriesBeforeSplit = latestEpoch(beforeSplit.optionSeries, ticker);
    expect(seriesBeforeSplit?.strike).toBe("29.95000000");
    expect(beforeSplit.optionPrices.find((price) => price.ticker === ticker)?.close).toBe(
      "2.000000",
    );

    const afterSplit = await buildOperationMarketView(
      db,
      tickerSchema.parse(underlying),
      instantSchema.parse(`${sessionD}T${SESSION_CLOSE_UTC}`),
    );
    const seriesAfterSplit = latestEpoch(afterSplit.optionSeries, ticker);
    expect(seriesAfterSplit?.strike).toBe("14.98000000");
    expect(afterSplit.optionPrices.find((price) => price.ticker === ticker)?.close).toBe(
      "1.000000",
    );

    const spanningView = await loadMarketView(db, {
      from: `${firstSession}T00:00:00.000Z`,
      to: `${lastSession}T23:59:59.000Z`,
      instruments: [tickerSchema.parse(underlying)],
      timeframes: ["D1"],
      collections: ["optionSeries", "optionPrices"],
    });
    const epochs = spanningView.optionSeries.filter((series) => series.ticker === ticker);
    const beforeEpoch = epochs.find((series) => series.strike === "29.95000000");
    const afterEpoch = epochs.find((series) => series.strike === "14.98000000");
    expect(beforeEpoch?.asOf).toBe(instantSchema.parse(`${sessionDMinus1}T${SESSION_CLOSE_UTC}`));
    expect(afterEpoch?.asOf).toBe(instantSchema.parse(`${sessionD}T${SESSION_CLOSE_UTC}`));

    // Idempotent: running the same statements again changes nothing.
    await runBackfillStatements();
    const rowsAfterRerun = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));
    const byStrikeAfterRerun = new Map(rowsAfterRerun.map((row) => [row.strike, row.asOf]));
    expect(byStrikeAfterRerun.get("29.95000000")).toEqual(
      new Date(`${sessionDMinus1}T${SESSION_CLOSE_UTC}`),
    );
    expect(byStrikeAfterRerun.get("14.98000000")).toEqual(
      new Date(`${sessionD}T${SESSION_CLOSE_UTC}`),
    );
  });

  it("dates a series' current strike at the session after its last old-strike trade when it never traded again", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BIL");
    const ticker = `${underlying}B310`;
    cleanupTickers.push(ticker);
    const expiry = "2099-06-16";

    const sessions = businessDays("2099-04-01", 8);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);
    const firstSession = sessions[0] ?? "";
    const lastOldTrade = sessions[3] ?? "";
    const nextSession = sessions[4] ?? "";

    await ensureMonthlyPartition(db, "option_daily_prices", lastOldTrade);
    await db.insert(optionDailyPrices).values({
      ticker,
      session: lastOldTrade,
      asOf: new Date(`${lastOldTrade}T${SESSION_CLOSE_UTC}`),
      right: "call",
      strike: "29.95000000",
      expiry,
      average: "2.000000",
      close: "2.000000",
      trades: 1,
      tradedQuantity: 100,
    });

    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike: "14.98000000",
      expiry,
      style: "european",
      asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
    });

    await runBackfillStatements();

    const [currentStrikeEpoch] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "14.98000000")),
      );
    expect(currentStrikeEpoch?.asOf).toEqual(new Date(`${nextSession}T${SESSION_OPEN_UTC}`));

    // Idempotent.
    await runBackfillStatements();
    const [afterRerun] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(
        and(eq(optionSeriesStrikes.ticker, ticker), eq(optionSeriesStrikes.strike, "14.98000000")),
      );
    expect(afterRerun?.asOf).toEqual(new Date(`${nextSession}T${SESSION_OPEN_UTC}`));
  });

  it("backfills a never-traded series directly from option_series's own as_of", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BNT");
    const ticker = `${underlying}B310`;
    cleanupTickers.push(ticker);

    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike: "10.00000000",
      expiry: "2099-06-16",
      style: "european",
      asOf: new Date("2099-01-02T13:00:00.000Z"),
    });

    await runBackfillStatements();

    const [epoch] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));
    expect(epoch?.asOf).toEqual(new Date("2099-01-02T13:00:00.000Z"));

    await runBackfillStatements();
    const [afterRerun] = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));
    expect(afterRerun?.asOf).toEqual(new Date("2099-01-02T13:00:00.000Z"));
  });

  it("does not abort when two ISINs share the same (ticker, expiry, right, strike), taking the earliest as_of between them", async () => {
    const db = getDb();
    const underlying = uniqueTicker("BDU");
    const ticker = `${underlying}B310`;
    cleanupTickers.push(ticker);
    const expiry = "2099-06-16";

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${ticker}-A`,
        ticker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date("2099-02-10T13:00:00.000Z"),
      },
      {
        isin: `ISIN-${ticker}-B`,
        ticker,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date("2099-01-05T13:00:00.000Z"),
      },
    ]);

    await expect(runBackfillStatements()).resolves.not.toThrow();

    const epochs = await db
      .select()
      .from(optionSeriesStrikes)
      .where(eq(optionSeriesStrikes.ticker, ticker));
    expect(epochs).toHaveLength(1);
    expect(epochs[0]?.asOf).toEqual(new Date("2099-01-05T13:00:00.000Z"));
  });

  it("invariant: no (ticker, expiry, right) cycle ever gets two strikes with the same as_of", async () => {
    const db = getDb();
    const expiry = "2099-06-16";
    const sessions = businessDays("2099-05-01", 8);
    cleanupSessionDates.push(...sessions);
    await seedSessions(sessions);
    const firstSession = sessions[0] ?? "";
    const secondSession = sessions[1] ?? "";
    const lastOldTrade = sessions[3] ?? "";
    const sessionD = sessions[4] ?? "";

    const underlying = uniqueTicker("BMX");
    const traded = `${underlying}A`;
    const oldStrikeOnly = `${underlying}B`;
    const neverTraded = `${underlying}C`;
    const duplicateIsin = `${underlying}D`;
    const tickers = [traded, oldStrikeOnly, neverTraded, duplicateIsin];
    cleanupTickers.push(...tickers);

    for (const session of [lastOldTrade, sessionD]) {
      await ensureMonthlyPartition(db, "option_daily_prices", session);
    }
    await db.insert(optionDailyPrices).values([
      {
        ticker: traded,
        session: lastOldTrade,
        asOf: new Date(`${lastOldTrade}T${SESSION_CLOSE_UTC}`),
        right: "call",
        strike: "29.95000000",
        expiry,
        average: "2.000000",
        close: "2.000000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: traded,
        session: sessionD,
        asOf: new Date(`${sessionD}T${SESSION_CLOSE_UTC}`),
        right: "call",
        strike: "14.98000000",
        expiry,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: oldStrikeOnly,
        session: lastOldTrade,
        asOf: new Date(`${lastOldTrade}T${SESSION_CLOSE_UTC}`),
        right: "call",
        strike: "29.95000000",
        expiry,
        average: "2.000000",
        close: "2.000000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${traded}`,
        ticker: traded,
        underlying,
        right: "call",
        strike: "14.98000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
      },
      {
        isin: `ISIN-${oldStrikeOnly}`,
        ticker: oldStrikeOnly,
        underlying,
        right: "call",
        strike: "14.98000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
      },
      {
        isin: `ISIN-${neverTraded}`,
        ticker: neverTraded,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
      },
      {
        isin: `ISIN-${duplicateIsin}-A`,
        ticker: duplicateIsin,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T${SESSION_OPEN_UTC}`),
      },
      {
        isin: `ISIN-${duplicateIsin}-B`,
        ticker: duplicateIsin,
        underlying,
        right: "call",
        strike: "10.00000000",
        expiry,
        style: "european",
        asOf: new Date(`${secondSession}T${SESSION_OPEN_UTC}`),
      },
    ]);

    await runBackfillStatements();

    const epochs = await db
      .select()
      .from(optionSeriesStrikes)
      .where(inArray(optionSeriesStrikes.ticker, tickers));
    expect(epochs.length).toBeGreaterThan(0);

    const byGroup = new Map<string, Date[]>();
    for (const epoch of epochs) {
      const key = `${epoch.ticker}|${epoch.expiry}|${epoch.right}`;
      const asOfs = byGroup.get(key) ?? [];
      asOfs.push(epoch.asOf);
      byGroup.set(key, asOfs);
    }
    for (const [key, asOfs] of byGroup) {
      const distinctAsOfs = new Set(asOfs.map((date) => date.getTime()));
      expect(distinctAsOfs.size, `group ${key} has two strikes sharing an as_of`).toBe(
        asOfs.length,
      );
    }
  });
});
