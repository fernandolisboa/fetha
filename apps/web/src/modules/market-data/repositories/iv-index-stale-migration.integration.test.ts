import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { loadMigrationStatements } from "@/db/test/migration-sql";

import { impliedVolatilityIndexPoints, ingestionRuns } from "../schema";

const BEFORE_FIX = new Date("2026-09-30T12:00:00.000Z");
const AFTER_FIX = new Date("2026-10-01T09:00:00.000Z");

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

const cleanupUnderlyings: string[] = [];
const cleanupSessions: string[] = [];

afterEach(async () => {
  const db = getDb();
  const underlyings = cleanupUnderlyings.splice(0);
  if (underlyings.length > 0) {
    await db
      .delete(impliedVolatilityIndexPoints)
      .where(inArray(impliedVolatilityIndexPoints.underlying, underlyings));
  }
  const sessions = cleanupSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(ingestionRuns).where(inArray(ingestionRuns.session, sessions));
  }
});

describe("migration 0046", () => {
  it("marks points computed before the point-in-time strike fix stale and reopens their sessions", async () => {
    const db = getDb();
    const early = uniqueTicker("EAR");
    const late = uniqueTicker("LAT");
    cleanupUnderlyings.push(early, late);
    const staleSession = "2083-03-01";
    const freshSession = "2083-03-02";
    cleanupSessions.push(staleSession, freshSession);

    await db.insert(impliedVolatilityIndexPoints).values([
      {
        underlying: early,
        session: staleSession,
        asOf: new Date(`${staleSession}T21:00:00.000Z`),
        impliedVolatility: "0.30000000",
        method: "atm_30d_variance_interpolated",
        computedAt: BEFORE_FIX,
      },
      {
        underlying: late,
        session: freshSession,
        asOf: new Date(`${freshSession}T21:00:00.000Z`),
        impliedVolatility: "0.31000000",
        method: "atm_30d_variance_interpolated",
        computedAt: AFTER_FIX,
      },
    ]);
    await db.insert(ingestionRuns).values(
      [staleSession, freshSession].flatMap((session) => [
        {
          source: "iv_index" as const,
          session,
          status: "succeeded" as const,
          startedAt: AFTER_FIX,
        },
        {
          source: "cotahist" as const,
          session,
          status: "succeeded" as const,
          startedAt: AFTER_FIX,
        },
      ]),
    );

    const [, markStale, reopenSessions] = loadMigrationStatements("0046_iv_index_stale");
    await db.execute(sql.raw(markStale ?? ""));
    await db.execute(sql.raw(reopenSessions ?? ""));

    const points = await db
      .select({
        underlying: impliedVolatilityIndexPoints.underlying,
        stale: impliedVolatilityIndexPoints.stale,
        impliedVolatility: impliedVolatilityIndexPoints.impliedVolatility,
      })
      .from(impliedVolatilityIndexPoints)
      .where(inArray(impliedVolatilityIndexPoints.underlying, [early, late]));
    expect(new Map(points.map((point) => [point.underlying, point.stale]))).toEqual(
      new Map([
        [early, true],
        [late, false],
      ]),
    );
    expect(points.find((point) => point.underlying === early)?.impliedVolatility).toBe(
      "0.30000000",
    );

    const runs = await db
      .select({ source: ingestionRuns.source, session: ingestionRuns.session })
      .from(ingestionRuns)
      .where(
        and(
          inArray(ingestionRuns.session, [staleSession, freshSession]),
          eq(ingestionRuns.status, "succeeded"),
        ),
      );
    expect(runs.map((run) => `${run.source}|${run.session}`).sort()).toEqual(
      [`cotahist|${freshSession}`, `cotahist|${staleSession}`, `iv_index|${freshSession}`].sort(),
    );
  });
});
