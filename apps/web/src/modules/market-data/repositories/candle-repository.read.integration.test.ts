import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { candles } from "../schema";

import { cotahistStockRowSchema } from "../adapters/cotahist/schema";
import {
  candleSessionBoundsInRange,
  latestCandle,
  recentDailyCandles,
  searchInstruments,
  upsertDailyCandles,
  upsertIndexCandles,
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
const INDEX_TICKER = "IBOV11";

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, TICKER_A));
  await db.delete(candles).where(eq(candles.ticker, TICKER_B));
  await db.delete(candles).where(eq(candles.ticker, INDEX_TICKER));
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
  it("searchInstruments finds the alias 'ibovespa' for IBOV11", async () => {
    const db = getDb();
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "180000.000000" }],
      INDEX_TICKER,
      new Map([["2026-05-12", new Date("2026-05-12T21:00:00.000Z")]]),
    );

    const results = await searchInstruments(db, "ibovespa", 10);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ticker: INDEX_TICKER });
  });

  it("searchInstruments finds IBOV11 exactly once for 'ibov', never duplicated by the alias", async () => {
    const db = getDb();
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "180000.000000" }],
      INDEX_TICKER,
      new Map([["2026-05-12", new Date("2026-05-12T21:00:00.000Z")]]),
    );

    const results = await searchInstruments(db, "ibov", 10);

    expect(results.filter((row) => row.ticker === INDEX_TICKER)).toHaveLength(1);
  });

  it("searchInstruments never matches IBOV11 for an unrelated query", async () => {
    const db = getDb();
    await upsertDailyCandles(db, "2026-05-12", new Date("2026-05-12T21:00:00.000Z"), [
      stockRow({ ticker: "PETR4", session: "2026-05-12" }),
    ]);
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "180000.000000" }],
      INDEX_TICKER,
      new Map([["2026-05-12", new Date("2026-05-12T21:00:00.000Z")]]),
    );

    const results = await searchInstruments(db, "petr", 10);

    expect(results.every((row) => row.ticker !== INDEX_TICKER)).toBe(true);
    await db.delete(candles).where(eq(candles.ticker, "PETR4"));
  });
});

describe("upsertIndexCandles", () => {
  afterEach(cleanup);

  it("writes O=H=L=C with zero traded quantity and the given asOf", async () => {
    const db = getDb();
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "180123.456789" }],
      INDEX_TICKER,
      new Map([["2026-05-12", new Date("2026-05-12T21:00:00.000Z")]]),
    );

    const row = await latestCandle(db, INDEX_TICKER);

    expect(row).toMatchObject({
      open: "180123.456789",
      high: "180123.456789",
      low: "180123.456789",
      close: "180123.456789",
      tradedQuantity: 0,
    });
  });

  it("spans more than one calendar month in a single call", async () => {
    const db = getDb();
    const asOf = new Map([
      ["2026-04-30", new Date("2026-04-30T21:00:00.000Z")],
      ["2026-05-04", new Date("2026-05-04T21:00:00.000Z")],
    ]);
    const rowCount = await upsertIndexCandles(
      db,
      [
        { date: "2026-04-30", close: "170000.000000" },
        { date: "2026-05-04", close: "171000.000000" },
      ],
      INDEX_TICKER,
      asOf,
    );

    expect(rowCount).toBe(2);
    const row = await latestCandle(db, INDEX_TICKER);
    expect(row?.session).toBe("2026-05-04");
  });

  it("upserts idempotently on (ticker, timeframe, session)", async () => {
    const db = getDb();
    const asOf = new Map([["2026-05-12", new Date("2026-05-12T21:00:00.000Z")]]);
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "180000.000000" }],
      INDEX_TICKER,
      asOf,
    );
    await upsertIndexCandles(
      db,
      [{ date: "2026-05-12", close: "181000.000000" }],
      INDEX_TICKER,
      asOf,
    );

    const row = await latestCandle(db, INDEX_TICKER);
    expect(row?.close).toBe("181000.000000");
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

  it("is undefined when the calendar carries the range but no ticker in the universe has a candle in it", async () => {
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
