import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles } from "@/db/schema/market-data";

import { cotahistStockRowSchema } from "../adapters/cotahist/schema";
import {
  candleSessionBoundsInRange,
  latestCandle,
  recentDailyCandles,
  searchInstruments,
  upsertDailyCandles,
} from "./candle-repository";

function stockRow(overrides: Partial<Parameters<typeof cotahistStockRowSchema.parse>[0]> = {}) {
  return cotahistStockRowSchema.parse({
    kind: "stock",
    session: "2026-05-11",
    ticker: "WLST3",
    open: "10.000000",
    high: "11.000000",
    low: "9.000000",
    average: "10.500000",
    close: "10.750000",
    trades: 100,
    tradedQuantity: 5000,
    ...overrides,
  });
}

const TICKER_A = "WLST3";
const TICKER_B = "WLSU3";

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, TICKER_A));
  await db.delete(candles).where(eq(candles.ticker, TICKER_B));
}

afterEach(cleanup);

describe("candle-repository reads", () => {
  it("searchInstruments finds tickers by prefix with their latest close", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-11", close: "10.750000" }),
    ]);
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12", close: "11.250000" }),
    ]);
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_B, session: "2026-05-12", close: "5.000000" }),
    ]);

    const results = await searchInstruments(db, "WLST", 10);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      ticker: TICKER_A,
      session: "2026-05-12",
      close: "11.250000",
    });
  });

  it("searchInstruments is case-insensitive and bounded by limit", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
      stockRow({ ticker: TICKER_B, session: "2026-05-12" }),
    ]);

    const results = await searchInstruments(db, "wls", 1);

    expect(results).toHaveLength(1);
  });

  it.each(["%", "_", "\\", "PE_R4", "AB%CD", "A\\B"])(
    "searchInstruments rejects a query carrying a live ILIKE wildcard (%j)",
    async (query) => {
      const db = getDb();
      await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
        stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
      ]);

      const results = await searchInstruments(db, query, 20);

      expect(results).toEqual([]);
    },
  );

  it("latestCandle returns null when the ticker has no candles", async () => {
    const db = getDb();
    expect(await latestCandle(db, "NADA3")).toBeNull();
  });

  it("recentDailyCandles returns candles oldest first, bounded by limit", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-11", close: "10.000000" }),
    ]);
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12", close: "11.000000" }),
    ]);

    const rows = await recentDailyCandles(db, TICKER_A, 10);

    expect(rows.map((row) => row.session)).toEqual(["2026-05-11", "2026-05-12"]);
    expect(rows[0]?.close).toBe("10.000000");
  });

  it("recentDailyCandles never returns rows for another ticker", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
      stockRow({ ticker: TICKER_B, session: "2026-05-12" }),
    ]);

    const rows = await recentDailyCandles(db, TICKER_A, 10);

    expect(rows.every((row) => row.ticker === TICKER_A)).toBe(true);
  });
});

describe("candleSessionBoundsInRange", () => {
  it("returns the earliest and latest session with a candle for any ticker in the universe", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-10", new Date("2026-05-10T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-10" }),
    ]);
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
    ]);
    await upsertDailyCandles(db, "2026-05-20", new Date("2026-05-20T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_B, session: "2026-05-20" }),
    ]);

    const result = await candleSessionBoundsInRange(db, [TICKER_A, TICKER_B], {
      from: "2026-05-01",
      to: "2026-05-31",
    });

    expect(result).toEqual({ first: "2026-05-10", last: "2026-05-20" });
  });

  it("clamps both ends to sessions strictly inside the requested range, not the earliest/latest ever ingested", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-04-01", new Date("2026-04-01T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-04-01" }),
    ]);
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
    ]);
    await upsertDailyCandles(db, "2026-06-15", new Date("2026-06-15T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-06-15" }),
    ]);

    const result = await candleSessionBoundsInRange(db, [TICKER_A], {
      from: "2026-05-01",
      to: "2026-05-31",
    });

    expect(result).toEqual({ first: "2026-05-12", last: "2026-05-12" });
  });

  it("is undefined when the calendar carries the range but no ticker in the universe has a candle in it (round 3 item 1)", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: TICKER_A, session: "2026-05-12" }),
    ]);

    const result = await candleSessionBoundsInRange(db, [TICKER_A], {
      from: "2026-06-01",
      to: "2026-06-30",
    });

    expect(result).toBeUndefined();
  });

  it("is undefined for an empty universe", async () => {
    const db = getDb();
    const result = await candleSessionBoundsInRange(db, [], {
      from: "2026-05-01",
      to: "2026-05-31",
    });
    expect(result).toBeUndefined();
  });
});
