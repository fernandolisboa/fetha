import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles, impliedVolatilityIndexPoints, optionDailyPrices, optionSeries } from "../schema";

import { DAILY_TIMEFRAME } from "./candle-repository";
import {
  ivIndexPointsInRange,
  underlyingsToComputeForSession,
  upsertIvIndexPoints,
} from "./iv-index-repository";
import { ensureMonthlyPartition } from "./partitions";

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

// Years 2081-2085: disjoint from every other integration fixture's own
// "far future" literal (see market-view.integration.test.ts's own comment).
function randomSession(): string {
  const year = 2081 + Math.floor(Math.random() * 4);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 27);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("iv-index-repository", () => {
  const cleanupUnderlyings: string[] = [];
  const cleanupOptionTickers: string[] = [];
  const cleanupSessions: string[] = [];

  afterEach(async () => {
    const db = getDb();
    const underlyings = cleanupUnderlyings.splice(0);
    if (underlyings.length > 0) {
      await db
        .delete(impliedVolatilityIndexPoints)
        .where(inArray(impliedVolatilityIndexPoints.underlying, underlyings));
      await db.delete(candles).where(inArray(candles.ticker, underlyings));
      await db.delete(optionSeries).where(inArray(optionSeries.underlying, underlyings));
    }
    const optionTickers = cleanupOptionTickers.splice(0);
    if (optionTickers.length > 0) {
      await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
    }
    cleanupSessions.splice(0);
  });

  describe("upsertIvIndexPoints / ivIndexPointsInRange", () => {
    it("writes points and reads them back over a session range", async () => {
      const db = getDb();
      const underlying = uniqueTicker("IVR");
      cleanupUnderlyings.push(underlying);
      const s1 = randomSession();
      const s2 = randomSession();

      const written = await upsertIvIndexPoints(db, [
        {
          underlying,
          session: s1,
          asOf: new Date(`${s1}T20:00:00.000Z`),
          impliedVolatility: "0.25000000",
          method: "atm_30d_variance_interpolated",
        },
        {
          underlying,
          session: s2,
          asOf: new Date(`${s2}T20:00:00.000Z`),
          impliedVolatility: "0.27500000",
          method: "atm_30d_variance_interpolated",
        },
      ]);
      expect(written).toBe(2);

      const [from, to] = [s1, s2].sort();
      const rows = await ivIndexPointsInRange(db, [underlying], from ?? "", to ?? "");
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.session))).toEqual(new Set([s1, s2]));
    });

    it("updates an existing point's asOf, impliedVolatility and method on conflict, rather than duplicating the row", async () => {
      const db = getDb();
      const underlying = uniqueTicker("IVU");
      cleanupUnderlyings.push(underlying);
      const session = randomSession();

      await upsertIvIndexPoints(db, [
        {
          underlying,
          session,
          asOf: new Date(`${session}T20:00:00.000Z`),
          impliedVolatility: "0.20000000",
          method: "atm_30d_variance_interpolated",
        },
      ]);
      await upsertIvIndexPoints(db, [
        {
          underlying,
          session,
          asOf: new Date(`${session}T21:00:00.000Z`),
          impliedVolatility: "0.30000000",
          method: "atm_30d_variance_interpolated",
        },
      ]);

      const rows = await ivIndexPointsInRange(db, [underlying], session, session);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.impliedVolatility).toBe("0.30000000");
      expect(rows[0]?.asOf.toISOString()).toBe(`${session}T21:00:00.000Z`);
    });

    it("returns nothing for an underlying with no ingested points", async () => {
      const db = getDb();
      const underlying = uniqueTicker("IVN");
      const session = randomSession();
      const rows = await ivIndexPointsInRange(db, [underlying], session, session);
      expect(rows).toEqual([]);
    });
  });

  describe("underlyingsToComputeForSession", () => {
    it("includes an underlying only when it has both an option day price and a stock candle on that session", async () => {
      const db = getDb();
      const session = randomSession();
      cleanupSessions.push(session);

      const both = uniqueTicker("BTH");
      const optionOnly = uniqueTicker("OPO");
      const candleOnly = uniqueTicker("CDO");
      cleanupUnderlyings.push(both, optionOnly, candleOnly);
      const bothOption = `${both}W1`;
      const optionOnlyOption = `${optionOnly}W1`;
      cleanupOptionTickers.push(bothOption, optionOnlyOption);

      await Promise.all([
        ensureMonthlyPartition(db, "candles", session),
        ensureMonthlyPartition(db, "option_daily_prices", session),
      ]);

      await db.insert(candles).values([
        {
          ticker: both,
          timeframe: DAILY_TIMEFRAME,
          session,
          asOf: new Date(`${session}T20:00:00.000Z`),
          open: "10.000000",
          high: "10.000000",
          low: "10.000000",
          close: "10.000000",
          tradedQuantity: 100,
        },
        {
          ticker: candleOnly,
          timeframe: DAILY_TIMEFRAME,
          session,
          asOf: new Date(`${session}T20:00:00.000Z`),
          open: "10.000000",
          high: "10.000000",
          low: "10.000000",
          close: "10.000000",
          tradedQuantity: 100,
        },
      ]);

      await db.insert(optionSeries).values([
        {
          isin: `ISIN-${bothOption}`,
          ticker: bothOption,
          underlying: both,
          right: "call",
          strike: "10.00000000",
          expiry: session,
          style: "european",
          asOf: new Date(`${session}T13:00:00.000Z`),
        },
        {
          isin: `ISIN-${optionOnlyOption}`,
          ticker: optionOnlyOption,
          underlying: optionOnly,
          right: "call",
          strike: "10.00000000",
          expiry: session,
          style: "european",
          asOf: new Date(`${session}T13:00:00.000Z`),
        },
      ]);

      await db.insert(optionDailyPrices).values([
        {
          ticker: bothOption,
          session,
          asOf: new Date(`${session}T20:00:00.000Z`),
          right: "call",
          strike: "10.00000000",
          expiry: session,
          average: "0.500000",
          close: "0.500000",
          trades: 1,
          tradedQuantity: 100,
        },
        {
          ticker: optionOnlyOption,
          session,
          asOf: new Date(`${session}T20:00:00.000Z`),
          right: "call",
          strike: "10.00000000",
          expiry: session,
          average: "0.500000",
          close: "0.500000",
          trades: 1,
          tradedQuantity: 100,
        },
      ]);

      const underlyings = await underlyingsToComputeForSession(db, session);
      expect(underlyings).toContain(both);
      expect(underlyings).not.toContain(optionOnly);
      expect(underlyings).not.toContain(candleOnly);

      await db.delete(optionDailyPrices).where(eq(optionDailyPrices.session, session));
    });
  });
});
