import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";

import { radarUniverse } from "./radar-view";
import {
  impliedVolatilityIndexPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "./schema";

const SESSION = "2026-07-13";
const STOCK_TICKER = "ZZRU3";
const STOCK_OPTION_TICKER = "ZZRUW999";
const STOCK_OPTION_ISIN = "BRZZRUOPTW01";
const INDEX_OPTION_TICKER = "IBOVA999";
const INDEX_OPTION_ISIN = "BRIBOVOPTW99";

async function seedSeries(ticker: string, isin: string, underlying: string): Promise<void> {
  const db = getDb();
  await db.insert(optionSeries).values({
    isin,
    ticker,
    underlying,
    right: "call",
    strike: "10.00000000",
    expiry: "2026-12-18",
    style: "european",
    asOf: new Date(`${SESSION}T21:00:00.000Z`),
  });
  await db.insert(optionDailyPrices).values({
    ticker,
    session: SESSION,
    asOf: new Date(`${SESSION}T21:00:00.000Z`),
    right: "call",
    strike: "10.00000000",
    expiry: "2026-12-18",
    close: "1.000000",
    trades: 5,
    tradedQuantity: 100,
  });
  await db.insert(impliedVolatilityIndexPoints).values({
    underlying,
    session: SESSION,
    asOf: new Date(`${SESSION}T21:00:00.000Z`),
    impliedVolatility: "0.25000000",
    method: "atm_30d_variance_interpolated",
  });
}

async function seedTradingSession(): Promise<void> {
  const db = getDb();
  await db
    .insert(tradingSessions)
    .values({
      date: SESSION,
      open: new Date(`${SESSION}T13:00:00.000Z`),
      close: new Date(`${SESSION}T21:00:00.000Z`),
    })
    .onConflictDoNothing();
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db
    .delete(optionDailyPrices)
    .where(inArray(optionDailyPrices.ticker, [STOCK_OPTION_TICKER, INDEX_OPTION_TICKER]));
  await db
    .delete(optionSeries)
    .where(inArray(optionSeries.isin, [STOCK_OPTION_ISIN, INDEX_OPTION_ISIN]));
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(inArray(impliedVolatilityIndexPoints.underlying, [STOCK_TICKER, "IBOV11"]));
  await db.delete(tradingSessions).where(eq(tradingSessions.date, SESSION));
}

afterEach(cleanup);

describe("radarUniverse", () => {
  it("excludes a market index even when it has an IV index point and traded options on another series", async () => {
    await seedTradingSession();
    await seedSeries(STOCK_OPTION_TICKER, STOCK_OPTION_ISIN, STOCK_TICKER);
    await seedSeries(INDEX_OPTION_TICKER, INDEX_OPTION_ISIN, "IBOV11");

    const universe = await radarUniverse(getDb(), SESSION, {
      windowSessions: 60,
      minTradedSessions: 1,
    });

    expect(universe).toContain(STOCK_TICKER);
    expect(universe).not.toContain("IBOV11");
  });

  it("returns null when the calendar does not hold the session", async () => {
    const universe = await radarUniverse(getDb(), "1999-01-01", {
      windowSessions: 60,
      minTradedSessions: 1,
    });
    expect(universe).toBeNull();
  });
});
