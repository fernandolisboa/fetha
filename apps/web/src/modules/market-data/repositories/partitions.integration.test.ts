import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";

import { ensureMonthlyPartition } from "./partitions";

async function partitionExists(name: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute<{ exists: boolean }>(
    sql`select exists (select 1 from pg_class where relname = ${name}) as "exists"`,
  );
  return Boolean(result.rows[0]?.exists);
}

afterEach(async () => {
  const db = getDb();
  await db.execute(sql`drop table if exists candles_2031_05`);
});

describe("ensureMonthlyPartition", () => {
  it("creates the expected month's partition for a date range beyond the migration's initial window", async () => {
    expect(await partitionExists("candles_2031_05")).toBe(false);

    await ensureMonthlyPartition(getDb(), "candles", "2031-05-15");

    expect(await partitionExists("candles_2031_05")).toBe(true);
  });

  it("is idempotent: calling it twice for the same month does not error", async () => {
    await ensureMonthlyPartition(getDb(), "candles", "2031-05-01");
    await expect(ensureMonthlyPartition(getDb(), "candles", "2031-05-20")).resolves.not.toThrow();
  });

  it("already created the migration's initial partitions (2024-2026)", async () => {
    expect(await partitionExists("candles_2026_09")).toBe(true);
    expect(await partitionExists("option_daily_prices_2026_09")).toBe(true);
  });
});
