import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { strategies, strategyVersions } from "@/modules/strategies/schema";

import { BacktestsDataExport } from "./data-export";
import { backtestRuns } from "./schema";

function uniqueEmail(label: string): string {
  return `fetha-backtests-export-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email,
      emailVerified: true,
      termsVersion: "2026-09-09",
      termsAcceptedAt: new Date(),
    })
    .returning({ id: user.id });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

async function seedStrategy(
  userId: string,
): Promise<{ strategyId: string; strategyVersionId: string }> {
  const db = getDb();
  const [strategy] = await db
    .insert(strategies)
    .values({ userId, name: `export-${crypto.randomUUID()}`, visibility: "private" })
    .returning({ id: strategies.id });
  if (!strategy) {
    throw new Error("failed to insert test strategy");
  }
  const [version] = await db
    .insert(strategyVersions)
    .values({
      strategyId: strategy.id,
      versionNumber: 1,
      definition: {} as never,
      definitionDigest: crypto.randomUUID(),
    })
    .returning({ id: strategyVersions.id });
  if (!version) {
    throw new Error("failed to insert test strategy version");
  }
  return { strategyId: strategy.id, strategyVersionId: version.id };
}

function runValues(userId: string, strategyId: string, strategyVersionId: string) {
  return {
    userId,
    strategyId,
    strategyVersionId,
    structure: {} as never,
    universe: ["PETR4"],
    periodFrom: "2026-01-02",
    periodTo: "2026-09-25",
    initialCapital: 10_000_000,
    costModel: {} as never,
    riskProfile: {} as never,
    limits: "enforce" as const,
    seed: 1,
    configDigest: crypto.randomUUID(),
  };
}

async function insertRun(
  userId: string,
  strategyId: string,
  strategyVersionId: string,
): Promise<string> {
  const [row] = await getDb()
    .insert(backtestRuns)
    .values(runValues(userId, strategyId, strategyVersionId))
    .returning({ id: backtestRuns.id });
  if (!row) {
    throw new Error("failed to insert test backtest run");
  }
  return row.id;
}

// One INSERT statement evaluates `now()` once, so every row it produces
// shares the same microsecond-precision `created_at`: the case a
// `created_at` cursor cannot resolve.
async function insertRunsSharingTimestamp(
  userId: string,
  strategyId: string,
  strategyVersionId: string,
  count: number,
): Promise<string[]> {
  const rows = await getDb()
    .insert(backtestRuns)
    .values(Array.from({ length: count }, () => runValues(userId, strategyId, strategyVersionId)))
    .returning({ id: backtestRuns.id });
  return rows.map((row) => row.id);
}

async function collect(tables: AsyncIterable<object> | readonly object[]): Promise<object[]> {
  const rows: object[] = [];
  for await (const row of tables) {
    rows.push(row);
  }
  return rows;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("BacktestsDataExport", () => {
  it("pages through more runs than one page, each once, ascending by id, without user B's runs", async () => {
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const strategyA = await seedStrategy(userA.id);
    const strategyB = await seedStrategy(userB.id);

    const runIdsA = [
      await insertRun(userA.id, strategyA.strategyId, strategyA.strategyVersionId),
      await insertRun(userA.id, strategyA.strategyId, strategyA.strategyVersionId),
      ...(await insertRunsSharingTimestamp(
        userA.id,
        strategyA.strategyId,
        strategyA.strategyVersionId,
        4,
      )),
      await insertRun(userA.id, strategyA.strategyId, strategyA.strategyVersionId),
    ];
    expect(runIdsA.length).toBeGreaterThanOrEqual(7);
    await insertRun(userB.id, strategyB.strategyId, strategyB.strategyVersionId);
    await insertRun(userB.id, strategyB.strategyId, strategyB.strategyVersionId);

    const exportRepo = new BacktestsDataExport(getDb(), userA, 2);
    const { backtest_runs: rows } = await exportRepo.tables();
    const runs = (await collect(rows as AsyncIterable<{ id: string }>)) as { id: string }[];

    expect(runs).toHaveLength(runIdsA.length);
    expect(new Set(runs.map((run) => run.id))).toEqual(new Set(runIdsA));
    for (let i = 1; i < runs.length; i++) {
      const [previous, current] = [runs[i - 1], runs[i]];
      expect(previous && current && previous.id < current.id).toBe(true);
    }
  });

  it("returns nothing for a user with no backtest runs", async () => {
    const emailA = uniqueEmail("empty");
    createdEmails.push(emailA);
    const userA = await insertBareUser(emailA);

    const exportRepo = new BacktestsDataExport(getDb(), userA, 2);
    const { backtest_runs: rows } = await exportRepo.tables();
    const runs = await collect(rows ?? []);

    expect(runs).toHaveLength(0);
  });

  it("refuses a non-positive or non-integer page size", async () => {
    const emailA = uniqueEmail("pagesize-guard");
    createdEmails.push(emailA);
    const userA = await insertBareUser(emailA);
    const db = getDb();

    expect(() => new BacktestsDataExport(db, userA, 0)).toThrow(RangeError);
    expect(() => new BacktestsDataExport(db, userA, -1)).toThrow(RangeError);
    expect(() => new BacktestsDataExport(db, userA, 1.5)).toThrow(RangeError);
  });
});
