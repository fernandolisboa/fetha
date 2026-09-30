import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { ingestionRuns } from "../schema";

import { succeededSessionsMissingRun } from "./ingestion-run-repository";

const SESSIONS = ["2092-03-02", "2092-03-03", "2092-03-04"] as const;

afterEach(async () => {
  const db = getDb();
  await db.delete(ingestionRuns).where(inArray(ingestionRuns.session, SESSIONS));
});

describe("succeededSessionsMissingRun", () => {
  it("returns only sessions where every required source succeeded but the missing source has not, newest first", async () => {
    const db = getDb();
    const now = new Date();
    await db.insert(ingestionRuns).values([
      {
        source: "cotahist",
        session: SESSIONS[0],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
      {
        source: "instruments",
        session: SESSIONS[0],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
      // Session 1: cotahist succeeded but instruments did not — must be excluded.
      {
        source: "cotahist",
        session: SESSIONS[1],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
      { source: "instruments", session: SESSIONS[1], status: "failed", startedAt: now, error: "x" },
      // Session 2: both required sources succeeded, and iv_index already has too — must be excluded.
      {
        source: "cotahist",
        session: SESSIONS[2],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
      {
        source: "instruments",
        session: SESSIONS[2],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
      {
        source: "iv_index",
        session: SESSIONS[2],
        status: "succeeded",
        startedAt: now,
        rowCount: 1,
      },
    ]);

    const missing = await succeededSessionsMissingRun(db, ["cotahist", "instruments"], "iv_index");

    expect(missing).toContain(SESSIONS[0]);
    expect(missing).not.toContain(SESSIONS[1]);
    expect(missing).not.toContain(SESSIONS[2]);
  });

  it("orders results newest session first", async () => {
    const db = getDb();
    const now = new Date();
    await db.insert(ingestionRuns).values(
      SESSIONS.flatMap((session) => [
        {
          source: "cotahist" as const,
          session,
          status: "succeeded" as const,
          startedAt: now,
          rowCount: 1,
        },
        {
          source: "instruments" as const,
          session,
          status: "succeeded" as const,
          startedAt: now,
          rowCount: 1,
        },
      ]),
    );

    const missing = await succeededSessionsMissingRun(db, ["cotahist", "instruments"], "iv_index");
    const relevant = missing.filter((session) => (SESSIONS as readonly string[]).includes(session));

    expect(relevant).toEqual([...SESSIONS].reverse());
  });
});
