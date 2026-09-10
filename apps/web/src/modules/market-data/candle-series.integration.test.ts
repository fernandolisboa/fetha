import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { candles, corporateActionFactors } from "@/db/schema/market-data";

import { cotahistStockRowSchema } from "./adapters/cotahist/schema";
import { loadCandleSeries } from "./candle-series";
import { upsertDailyCandles } from "./repositories/candle-repository";

const TICKER = "CSER3" as Ticker;

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, TICKER));
  await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, TICKER));
}

afterEach(cleanup);

describe("loadCandleSeries", () => {
  it("returns the nominal series unchanged with no corporate actions", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: "2026-05-11",
        ticker: TICKER,
        open: "10.000000",
        high: "11.000000",
        low: "9.000000",
        average: "10.500000",
        close: "10.750000",
        trades: 100,
        tradedQuantity: 5000,
      }),
    ]);

    const result = await loadCandleSeries(
      db,
      TICKER,
      "nominal",
      new Date("2026-05-12T12:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candles).toHaveLength(1);
    expect(result.value.candles[0]?.close).toBe("10.750000");
  });

  it("adjusts earlier candles by a corporate-action factor visible at `at`", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: "2026-05-11",
        ticker: TICKER,
        open: "10.000000",
        high: "11.000000",
        low: "9.000000",
        average: "10.500000",
        close: "10.000000",
        trades: 100,
        tradedQuantity: 5000,
      }),
    ]);
    await db.insert(corporateActionFactors).values({
      ticker: TICKER,
      exDate: "2026-05-12",
      asOf: new Date("2026-05-12T00:00:00.000Z"),
      factor: "0.5",
    });

    const result = await loadCandleSeries(
      db,
      TICKER,
      "adjusted",
      new Date("2026-05-13T12:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candles[0]?.close).toBe("5.00");
  });

  it("returns an empty series for a ticker with no candles", async () => {
    const db = getDb();
    const result = await loadCandleSeries(db, "NADA3", "adjusted");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candles).toHaveLength(0);
  });
});
