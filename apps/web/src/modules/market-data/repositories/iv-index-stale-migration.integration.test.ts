import { inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { loadMigrationStatements } from "@/db/test/migration-sql";

import { corporateActionFactors, impliedVolatilityIndexPoints } from "../schema";

const BEFORE_FIX = new Date("2026-09-30T12:00:00.000Z");
const AFTER_FIX = new Date("2026-10-01T09:00:00.000Z");

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

const cleanupUnderlyings: string[] = [];

afterEach(async () => {
  const db = getDb();
  const underlyings = cleanupUnderlyings.splice(0);
  if (underlyings.length > 0) {
    await db
      .delete(impliedVolatilityIndexPoints)
      .where(inArray(impliedVolatilityIndexPoints.underlying, underlyings));
    await db
      .delete(corporateActionFactors)
      .where(inArray(corporateActionFactors.ticker, underlyings));
  }
});

describe("migration 0046", () => {
  it("marks stale the points computed before point-in-time strikes and every point of an underlying with a recorded factor", async () => {
    const db = getDb();
    const early = uniqueTicker("EAR");
    const late = uniqueTicker("LAT");
    const split = uniqueTicker("SPL");
    cleanupUnderlyings.push(early, late, split);
    const session = "2083-03-01";

    await db.insert(impliedVolatilityIndexPoints).values(
      [
        { underlying: early, computedAt: BEFORE_FIX },
        { underlying: late, computedAt: AFTER_FIX },
        { underlying: split, computedAt: AFTER_FIX },
      ].map((point) => ({
        ...point,
        session,
        asOf: new Date(`${session}T21:00:00.000Z`),
        impliedVolatility: "0.30000000",
        method: "atm_30d_variance_interpolated",
      })),
    );
    await db.insert(corporateActionFactors).values({
      ticker: split,
      exDate: "2083-04-01",
      asOf: new Date("2083-04-01T13:00:00.000Z"),
      factor: "0.50000000",
    });

    const [, markStale] = loadMigrationStatements("0046_iv_index_stale");
    await db.execute(sql.raw(markStale ?? ""));

    const points = await db
      .select({
        underlying: impliedVolatilityIndexPoints.underlying,
        stale: impliedVolatilityIndexPoints.stale,
        impliedVolatility: impliedVolatilityIndexPoints.impliedVolatility,
      })
      .from(impliedVolatilityIndexPoints)
      .where(inArray(impliedVolatilityIndexPoints.underlying, [early, late, split]));
    expect(new Map(points.map((point) => [point.underlying, point.stale]))).toEqual(
      new Map([
        [early, true],
        [late, false],
        [split, true],
      ]),
    );
    expect(points.every((point) => point.impliedVolatility === "0.30000000")).toBe(true);
  });
});
