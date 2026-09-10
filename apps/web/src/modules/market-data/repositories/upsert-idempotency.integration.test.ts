import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles, macroPoints, optionDailyPrices, optionSeries } from "@/db/schema/market-data";

import { cotahistOptionRowSchema, cotahistStockRowSchema } from "../adapters/cotahist/schema";
import { instrumentOptionSeriesSchema } from "../adapters/b3-instruments/schema";
import { macroPointSchema } from "../adapters/bacen-sgs/schema";
import { upsertDailyCandles } from "./candle-repository";
import { upsertMacroPoints } from "./macro-repository";
import { upsertOptionDailyPrices, upsertOptionSeries } from "./option-repository";

const SESSION = "2026-05-12";
const TICKER = "IDMP3";
const OPTION_TICKER = "IDMPW1";
const ISIN = "BRIDMPIDMPW01";

const stockRow = cotahistStockRowSchema.parse({
  kind: "stock",
  session: SESSION,
  ticker: TICKER,
  open: "10.000000",
  high: "11.000000",
  low: "9.000000",
  average: "10.500000",
  close: "10.750000",
  trades: 100,
  tradedQuantity: 5000,
});

const optionRow = cotahistOptionRowSchema.parse({
  kind: "option",
  session: SESSION,
  ticker: OPTION_TICKER,
  right: "call",
  strike: "12.000000",
  expiry: "2026-08-21",
  factor: "1",
  open: "1.000000",
  high: "1.200000",
  low: "0.900000",
  average: "1.050000",
  close: "1.100000",
  trades: 5,
  tradedQuantity: 300,
});

const seriesRow = instrumentOptionSeriesSchema.parse({
  ticker: OPTION_TICKER,
  isin: ISIN,
  underlying: TICKER,
  right: "call",
  strike: "12.00",
  expiry: "2026-08-21",
  style: "american",
  asOf: SESSION,
});

const macroPoint = macroPointSchema.parse({
  series: "selic",
  date: SESSION,
  asOf: `${SESSION}T13:00:00.000Z`,
  annualRate: "0.14000000",
});

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, TICKER));
  await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, OPTION_TICKER));
  await db.delete(optionSeries).where(eq(optionSeries.isin, ISIN));
  await db
    .delete(macroPoints)
    .where(and(eq(macroPoints.series, macroPoint.series), eq(macroPoints.date, macroPoint.date)));
}

afterEach(cleanup);

describe("repository upsert idempotency", () => {
  it("upsertDailyCandles: inserting the same row twice yields one row with the same values", async () => {
    const db = getDb();
    const asOf = new Date(`${SESSION}T20:00:00.000Z`);

    await upsertDailyCandles(db, SESSION, asOf, [stockRow]);
    await upsertDailyCandles(db, SESSION, asOf, [stockRow]);

    const rows = await db.select().from(candles).where(eq(candles.ticker, TICKER));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ close: "10.750000", open: "10.000000" });
  });

  it("upsertOptionDailyPrices: inserting the same row twice yields one row with the same values", async () => {
    const db = getDb();
    const asOf = new Date(`${SESSION}T20:00:00.000Z`);

    await upsertOptionDailyPrices(db, SESSION, asOf, [optionRow]);
    await upsertOptionDailyPrices(db, SESSION, asOf, [optionRow]);

    const rows = await db
      .select()
      .from(optionDailyPrices)
      .where(eq(optionDailyPrices.ticker, OPTION_TICKER));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      close: "1.100000",
      strike: "12.00000000",
      right: "call",
      factor: "1.000000",
    });
  });

  it("upsertOptionDailyPrices: persists the quotation factor distinct from the strike's own unit", async () => {
    const db = getDb();
    const asOf = new Date(`${SESSION}T20:00:00.000Z`);
    const indexOptionRow = cotahistOptionRowSchema.parse({
      ...optionRow,
      ticker: `${OPTION_TICKER}I`,
      strike: "183000.000000",
      factor: "100",
    });

    await upsertOptionDailyPrices(db, SESSION, asOf, [indexOptionRow]);

    const [row] = await db
      .select()
      .from(optionDailyPrices)
      .where(eq(optionDailyPrices.ticker, `${OPTION_TICKER}I`));
    expect(row?.strike).toBe("183000.00000000");
    expect(row?.factor).toBe("100.000000");

    await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, `${OPTION_TICKER}I`));
  });

  it("upsertOptionSeries: inserting the same isin twice yields one row and never advances as_of backward-set on the first insert", async () => {
    const db = getDb();
    const firstAsOf = new Date(`${SESSION}T20:00:00.000Z`);

    await upsertOptionSeries(db, firstAsOf, [seriesRow]);
    await upsertOptionSeries(db, firstAsOf, [seriesRow]);

    const rows = await db.select().from(optionSeries).where(eq(optionSeries.isin, ISIN));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.asOf.toISOString()).toBe(firstAsOf.toISOString());
    expect(rows[0]?.strike).toBe("12.00000000");
  });

  it("upsertOptionSeries: as_of only ever moves backward (LEAST) on a later conflict, never forward", async () => {
    const db = getDb();
    const earlier = new Date(`${SESSION}T20:00:00.000Z`);
    const later = new Date(`2026-06-01T20:00:00.000Z`);

    await upsertOptionSeries(db, later, [seriesRow]);
    await upsertOptionSeries(db, earlier, [seriesRow]);

    const [row] = await db.select().from(optionSeries).where(eq(optionSeries.isin, ISIN));
    expect(row?.asOf.toISOString()).toBe(earlier.toISOString());

    await upsertOptionSeries(db, later, [seriesRow]);
    const [afterLater] = await db.select().from(optionSeries).where(eq(optionSeries.isin, ISIN));
    expect(afterLater?.asOf.toISOString()).toBe(earlier.toISOString());
  });

  it("upsertMacroPoints: inserting the same (series, date) row twice yields one row with the same values", async () => {
    const db = getDb();

    await upsertMacroPoints(db, [macroPoint]);
    await upsertMacroPoints(db, [macroPoint]);

    const rows = await db
      .select()
      .from(macroPoints)
      .where(and(eq(macroPoints.series, macroPoint.series), eq(macroPoints.date, macroPoint.date)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ annualRate: "0.14000000" });
  });

  it("upsertMacroPoints: a repeated (series, date) within one batch does not fail the upsert (dedupe, last wins)", async () => {
    const db = getDb();
    const stale = macroPointSchema.parse({ ...macroPoint, annualRate: "0.13000000" });

    const count = await upsertMacroPoints(db, [stale, macroPoint]);
    expect(count).toBe(1);

    const rows = await db
      .select()
      .from(macroPoints)
      .where(and(eq(macroPoints.series, macroPoint.series), eq(macroPoints.date, macroPoint.date)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ annualRate: "0.14000000" });
  });
});
