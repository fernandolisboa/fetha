import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { ingestionRuns, tradingSessions } from "@/db/schema/market-data";

import { freshness, latestSession } from "./freshness";

const SESSION = "2026-03-10";
const SOURCE = "cotahist" as const;

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(ingestionRuns).where(eq(ingestionRuns.session, SESSION));
  await db.delete(tradingSessions).where(eq(tradingSessions.date, SESSION));
}

afterEach(cleanup);

describe("freshness", () => {
  it("reports the last successful run recorded for a source", async () => {
    const db = getDb();
    const finishedAt = new Date("2026-03-10T23:00:00.000Z");
    await db.insert(ingestionRuns).values({
      source: SOURCE,
      session: SESSION,
      status: "succeeded",
      startedAt: new Date("2026-03-10T22:59:00.000Z"),
      finishedAt,
      rowCount: 42,
    });

    const report = await freshness(db);
    const cotahist = report.find((entry) => entry.source === SOURCE);
    expect(cotahist).toMatchObject({ session: SESSION, status: "succeeded" });
    expect(cotahist?.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
  });

  it("only reports the most recent run when several exist for the same source", async () => {
    const db = getDb();
    await db.insert(ingestionRuns).values([
      {
        source: SOURCE,
        session: "2026-03-09",
        status: "succeeded",
        startedAt: new Date("2026-03-09T22:00:00.000Z"),
        finishedAt: new Date("2026-03-09T22:05:00.000Z"),
        rowCount: 10,
      },
      {
        source: SOURCE,
        session: SESSION,
        status: "succeeded",
        startedAt: new Date("2026-03-10T22:00:00.000Z"),
        finishedAt: new Date("2026-03-10T22:05:00.000Z"),
        rowCount: 20,
      },
    ]);

    const report = await freshness(db);
    const cotahist = report.filter((entry) => entry.source === SOURCE);
    expect(cotahist).toHaveLength(1);
    expect(cotahist[0]?.session).toBe(SESSION);

    await db.delete(ingestionRuns).where(eq(ingestionRuns.session, "2026-03-09"));
  });
});

describe("latestSession", () => {
  it("returns the most recent trading session on or before the given instant", async () => {
    const db = getDb();
    await db.insert(tradingSessions).values({
      date: SESSION,
      open: new Date("2026-03-10T13:00:00.000Z"),
      close: new Date("2026-03-10T20:00:00.000Z"),
    });

    const session = await latestSession(db, new Date("2026-03-10T21:00:00.000Z"));
    expect(session).toBe(SESSION);

    const beforeOpen = await latestSession(db, new Date("2026-03-10T10:00:00.000Z"));
    expect(beforeOpen).not.toBe(SESSION);
  });
});
