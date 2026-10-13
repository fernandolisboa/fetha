import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { exchangeRates } from "../schema";

import { exchangeRatePointSchema } from "../adapters/bacen-sgs/schema";
import {
  exchangeRateSeries,
  latestExchangeRate,
  latestExchangeRateDate,
  upsertExchangeRates,
} from "./exchange-rate-repository";

const PAIR = "USDBRL";
const DATE_1 = "2026-10-07";
const DATE_2 = "2026-10-08";

const pointOne = exchangeRatePointSchema.parse({
  pair: PAIR,
  date: DATE_1,
  asOf: "2026-10-07T16:30:00.000Z",
  rate: "4.99350000",
});

const pointTwo = exchangeRatePointSchema.parse({
  pair: PAIR,
  date: DATE_2,
  asOf: "2026-10-08T16:30:00.000Z",
  rate: "5.01190000",
});

afterEach(async () => {
  const db = getDb();
  await db.delete(exchangeRates).where(eq(exchangeRates.pair, PAIR));
});

describe("upsertExchangeRates", () => {
  it("writes every point and reports the latest date/row per pair", async () => {
    const db = getDb();

    const written = await upsertExchangeRates(db, [pointOne, pointTwo]);
    expect(written).toBe(2);

    expect(await latestExchangeRateDate(db, PAIR)).toBe(DATE_2);
    expect(await latestExchangeRate(db, PAIR)).toMatchObject({ date: DATE_2, rate: "5.01190000" });

    const series = await exchangeRateSeries(db, PAIR);
    expect(series.map((row) => row.date)).toEqual([DATE_1, DATE_2]);
  });

  it("is idempotent: writing the same point again changes nothing but a corrected rate overwrites it", async () => {
    const db = getDb();
    await upsertExchangeRates(db, [pointOne]);

    const sameAgain = await upsertExchangeRates(db, [pointOne]);
    expect(sameAgain).toBe(1);
    expect(await latestExchangeRate(db, PAIR)).toMatchObject({ rate: "4.99350000" });

    const corrected = exchangeRatePointSchema.parse({ ...pointOne, rate: "5.00000000" });
    await upsertExchangeRates(db, [corrected]);
    expect(await latestExchangeRate(db, PAIR)).toMatchObject({ rate: "5.00000000" });

    const series = await exchangeRateSeries(db, PAIR);
    expect(series).toHaveLength(1);
  });

  it("dedupes two rows for the same (pair, date) in one call, keeping the last", async () => {
    const db = getDb();
    const stale = exchangeRatePointSchema.parse({ ...pointOne, rate: "1.00000000" });

    const written = await upsertExchangeRates(db, [stale, pointOne]);
    expect(written).toBe(1);
    expect(await latestExchangeRate(db, PAIR)).toMatchObject({ rate: pointOne.rate });
  });

  it("returns undefined/empty for a pair with no stored point", async () => {
    const db = getDb();
    expect(await latestExchangeRateDate(db, "EURBRL")).toBeUndefined();
    expect(await latestExchangeRate(db, "EURBRL")).toBeUndefined();
    expect(await exchangeRateSeries(db, "EURBRL")).toEqual([]);
  });

  it("is a no-op on an empty batch", async () => {
    const db = getDb();
    expect(await upsertExchangeRates(db, [])).toBe(0);
  });
});
