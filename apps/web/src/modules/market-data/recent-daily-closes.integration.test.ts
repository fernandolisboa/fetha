import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";

import { cotahistStockRowSchema } from "./adapters/cotahist/schema";
import { recentDailyCloses, upsertDailyCandles } from "./repositories/candle-repository";
import { candles } from "./schema";

const TICKERS = ["RDCA3", "RDCB3", "RDCC3"];

afterEach(async () => {
  await getDb().delete(candles).where(inArray(candles.ticker, TICKERS));
});

async function seed(ticker: string, session: string, close: string): Promise<void> {
  await upsertDailyCandles(getDb(), session, new Date(`${session}T21:00:00.000Z`), [
    cotahistStockRowSchema.parse({
      kind: "stock",
      session,
      ticker,
      open: close,
      high: close,
      low: close,
      average: close,
      close,
      trades: 10,
      tradedQuantity: 100,
    }),
  ]);
}

describe("recentDailyCloses", () => {
  it("returns each ticker's last closes oldest first, in one call, skipping tickers without candles", async () => {
    await seed("RDCA3", "2026-05-11", "10.000000");
    await seed("RDCA3", "2026-05-12", "11.000000");
    await seed("RDCA3", "2026-06-01", "12.500000");
    await seed("RDCB3", "2026-05-12", "20.000000");

    const closes = await recentDailyCloses(getDb(), ["RDCA3", "RDCB3", "RDCC3"], 2);

    expect(closes.get("RDCA3")).toEqual(["11.000000", "12.500000"]);
    expect(closes.get("RDCB3")).toEqual(["20.000000"]);
    expect(closes.has("RDCC3")).toBe(false);
  });

  it("returns an empty map for no tickers", async () => {
    expect((await recentDailyCloses(getDb(), [], 30)).size).toBe(0);
  });
});
