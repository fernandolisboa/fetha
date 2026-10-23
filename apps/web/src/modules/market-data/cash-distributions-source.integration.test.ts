import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { instantSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";

import { detectCashDistributionsForSession } from "./cash-distributions-source";
import { buildOperationMarketView, loadMarketView } from "./market-view";
import { ensureMonthlyPartition } from "./repositories/partitions";
import {
  candles,
  cashDistributions,
  corporateActionFactors,
  ingestionRuns,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "./schema";

const EXPIRY = "2098-12-17";
const SESSIONS = ["2098-03-09", "2098-03-10", "2098-03-11", "2098-03-12"] as const;

function open(session: string): Date {
  return new Date(`${session}T13:00:00.000Z`);
}

function close(session: string): Date {
  return new Date(`${session}T20:00:00.000Z`);
}

function session(index: number): string {
  const value = SESSIONS[index];
  if (!value) throw new Error(`fixture has no session ${String(index)}`);
  return value;
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

const cleanupUnderlyings: string[] = [];
const cleanupTickers: string[] = [];

afterEach(async () => {
  const db = getDb();
  const tickers = cleanupTickers.splice(0);
  if (tickers.length > 0) {
    await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
  }
  const underlyings = cleanupUnderlyings.splice(0);
  if (underlyings.length > 0) {
    await db.delete(cashDistributions).where(inArray(cashDistributions.underlying, underlyings));
    await db
      .delete(corporateActionFactors)
      .where(inArray(corporateActionFactors.ticker, underlyings));
    await db.delete(candles).where(inArray(candles.ticker, underlyings));
  }
  await db.delete(ingestionRuns).where(inArray(ingestionRuns.session, [...SESSIONS]));
  await db.delete(tradingSessions).where(inArray(tradingSessions.date, [...SESSIONS]));
});

async function seedCalendar(): Promise<void> {
  const db = getDb();
  await db
    .insert(tradingSessions)
    .values(SESSIONS.map((date) => ({ date, open: open(date), close: close(date) })))
    .onConflictDoNothing();
  await ensureMonthlyPartition(db, "option_daily_prices", session(0));
  await ensureMonthlyPartition(db, "candles", session(0));
}

async function markSucceeded(
  source: "cotahist" | "instruments",
  sessions: readonly string[],
): Promise<void> {
  await getDb()
    .insert(ingestionRuns)
    .values(
      sessions.map((date) => ({
        source,
        session: date,
        status: "succeeded" as const,
        startedAt: close(date),
        finishedAt: close(date),
        rowCount: 1,
      })),
    );
}

// One underlying with a listed call per strike; `strikesBySession` gives each call's strike
// on each fixture session, in the order of `SESSIONS`.
async function seedChain(
  label: string,
  strikesBySession: readonly (readonly string[])[],
  settlementStyle: "physical" | "cash" = "physical",
): Promise<string> {
  const db = getDb();
  const underlying = uniqueTicker(label);
  cleanupUnderlyings.push(underlying);
  const callCount = strikesBySession[0]?.length ?? 0;
  for (let call = 0; call < callCount; call += 1) {
    const ticker = `${underlying}C${String(call)}`;
    cleanupTickers.push(ticker);
    await db.insert(optionSeries).values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike: strikesBySession[0]?.[call] ?? "0",
      expiry: EXPIRY,
      style: "american",
      asOf: open(session(0)),
      settlementStyle,
    });
    for (const [index, strikes] of strikesBySession.entries()) {
      const strike = strikes[call];
      if (strike === undefined) continue;
      await db.insert(optionDailyPrices).values({
        ticker,
        session: session(index),
        asOf: close(session(index)),
        right: "call",
        strike,
        expiry: EXPIRY,
        average: "1.000000",
        close: "1.000000",
        trades: 1,
        tradedQuantity: 100,
      });
    }
  }
  return underlying;
}

async function storedDistributions(underlying: string) {
  return getDb()
    .select()
    .from(cashDistributions)
    .where(eq(cashDistributions.underlying, underlying));
}

describe("detectCashDistributionsForSession", () => {
  it("stores a uniform strike drop between consecutive sessions as a distribution", async () => {
    await seedCalendar();
    await markSucceeded("cotahist", [session(0), session(1)]);
    await markSucceeded("instruments", [session(1)]);
    const underlying = await seedChain("DIV", [
      ["30.00000000", "32.00000000", "34.50000000"],
      ["29.26000000", "31.26000000", "33.76000000"],
    ]);

    expect(await detectCashDistributionsForSession(getDb(), session(1))).toBe(1);

    expect(await storedDistributions(underlying)).toEqual([
      expect.objectContaining({
        underlying,
        exDate: session(1),
        asOf: close(session(1)),
        amount: "0.74000000",
        seriesCount: 3,
      }),
    ]);
  });

  it("leaves a proportional drop and a cash-settled chain alone", async () => {
    await seedCalendar();
    await markSucceeded("cotahist", [session(0), session(1)]);
    await markSucceeded("instruments", [session(1)]);
    const split = await seedChain("SPL", [
      ["30.00000000", "32.00000000"],
      ["15.00000000", "16.00000000"],
    ]);
    const index = await seedChain(
      "IDX",
      [
        ["130000.00000000", "135000.00000000"],
        ["129000.00000000", "134000.00000000"],
      ],
      "cash",
    );

    expect(await detectCashDistributionsForSession(getDb(), session(1))).toBe(0);
    expect(await storedDistributions(split)).toEqual([]);
    expect(await storedDistributions(index)).toEqual([]);
  });

  it("skips an underlying with a recorded factor ex-dated on the session", async () => {
    const db = getDb();
    await seedCalendar();
    await markSucceeded("cotahist", [session(0), session(1)]);
    await markSucceeded("instruments", [session(1)]);
    const underlying = await seedChain("FAC", [
      ["30.00000000", "32.00000000"],
      ["29.90000000", "31.90000000"],
    ]);
    await db
      .insert(corporateActionFactors)
      .values({ ticker: underlying, exDate: session(1), asOf: open(session(1)), factor: "0.99" });

    expect(await detectCashDistributionsForSession(db, session(1))).toBe(0);
  });

  it("pends until the session before has its own COTAHIST", async () => {
    await seedCalendar();
    await markSucceeded("cotahist", [session(1)]);
    await markSucceeded("instruments", [session(1)]);

    expect(await detectCashDistributionsForSession(getDb(), session(1))).toEqual({
      rowCount: 0,
      pending: true,
    });
  });

  it("keeps the first detection's stamp when the same session is detected again", async () => {
    await seedCalendar();
    await markSucceeded("cotahist", [session(0), session(1)]);
    await markSucceeded("instruments", [session(1)]);
    const underlying = await seedChain("IDM", [
      ["30.00000000", "32.00000000"],
      ["29.50000000", "31.50000000"],
    ]);

    await detectCashDistributionsForSession(getDb(), session(1));
    const [first] = await storedDistributions(underlying);
    await detectCashDistributionsForSession(getDb(), session(1));
    const [second] = await storedDistributions(underlying);

    expect(second?.detectedAt).toEqual(first?.detectedAt);
  });
});

describe("dividend yields in market views", () => {
  async function seedPayer(): Promise<string> {
    const db = getDb();
    await seedCalendar();
    const underlying = uniqueTicker("YLD");
    cleanupUnderlyings.push(underlying);
    await db.insert(candles).values(
      SESSIONS.map((date) => ({
        ticker: underlying,
        timeframe: "1d",
        session: date,
        asOf: close(date),
        open: "40.000000",
        high: "40.000000",
        low: "40.000000",
        close: "40.000000",
        tradedQuantity: 1000,
      })),
    );
    await db.insert(cashDistributions).values({
      underlying,
      exDate: session(1),
      asOf: close(session(1)),
      amount: "2.00000000",
      seriesCount: 10,
    });
    return underlying;
  }

  it("gives the operation view the trailing yield at the latest close", async () => {
    const underlying = await seedPayer();

    const view = await buildOperationMarketView(
      getDb(),
      tickerSchema.parse(underlying),
      instantSchema.parse(close(session(3)).toISOString()),
    );

    const byAsOf = [...view.dividendYields].sort((a, b) => a.asOf.localeCompare(b.asOf));
    expect(byAsOf).toEqual([
      { underlying, asOf: close(session(1)).toISOString(), annualYield: "0.05" },
      { underlying, asOf: close(session(2)).toISOString(), annualYield: "0.05" },
      { underlying, asOf: close(session(3)).toISOString(), annualYield: "0.05" },
    ]);
  });

  // The fixture's sessions are in 2098, so the late write is stamped after them.
  it("moves the window view's dataVersion when a past distribution is detected late", async () => {
    const db = getDb();
    const underlying = await seedPayer();
    const window = {
      from: instantSchema.parse(open(session(2)).toISOString()),
      to: instantSchema.parse(close(session(3)).toISOString()),
      instruments: [tickerSchema.parse(underlying)],
      timeframes: ["D1" as const],
      collections: ["candles" as const, "corporateActions" as const, "dividendYields" as const],
    };

    const before = await loadMarketView(db, window);
    await db
      .update(cashDistributions)
      .set({ detectedAt: new Date("2099-01-01T00:00:00.000Z") })
      .where(
        and(eq(cashDistributions.underlying, underlying), eq(cashDistributions.exDate, session(1))),
      );
    const after = await loadMarketView(db, window);

    expect(before.dividendYields.map((point) => point.annualYield)).toEqual(["0.05", "0.05"]);
    expect(after.dataVersion).not.toEqual(before.dataVersion);
  });
});
