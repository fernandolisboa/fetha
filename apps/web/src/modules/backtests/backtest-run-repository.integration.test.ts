import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { BacktestRun } from "@fetha/engine";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { backtestRuns } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { StrategiesRepository } from "@/modules/strategies";

import {
  BacktestRunAlreadyCompleteError,
  BacktestRunClaimError,
  BacktestRunNotFoundError,
  BacktestRunRepository,
  STALE_LEASE_MS,
} from "./backtest-run-repository";
import { DEFAULT_COST_MODEL, defaultRiskProfile } from "./default-config";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

function uniqueEmail(label: string): string {
  return `fetha-backtest-runs-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string; name: string; email: string }> {
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
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function definition(): StrategyDefinition {
  return {
    name: "Estratégia de isolamento",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("9") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.2") },
    exit: [],
    adjustments: [],
  };
}

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

function completedResult(version: { id: string; definition: StrategyDefinition }): BacktestRun {
  return {
    config: {
      strategy: {
        id: version.id,
        definition: version.definition,
        structure: STOCK_STRUCTURE,
      },
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      walkForward: null,
      seed: 1,
    },
    configDigest: "x",
    operations: [],
    fills: [],
    missedEntries: [],
    limitBreaches: [],
    equityCurve: [],
    metrics: {
      sessions: 0,
      operations: 0,
      totalReturn: decimalString("0"),
      cagr: null,
      maxDrawdown: decimalString("0"),
      sharpe: null,
      winRate: null,
      profitFactor: null,
      exposure: decimalString("0"),
      fees: centavos(0),
      taxes: centavos(0),
      slippage: centavos(0),
    },
    walkForward: null,
    taxes: [],
    notes: [],
    provenance: {
      engineVersion: "0.2.0",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("BacktestRunRepository isolation", () => {
  it("user A cannot read user B's backtest run", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategy = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const runB = await new BacktestRunRepository(db, userB).create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });

    await expect(new BacktestRunRepository(db, userA).findMine(runB.id)).rejects.toBeInstanceOf(
      BacktestRunNotFoundError,
    );
  });

  it("user A cannot save progress or complete user B's backtest run", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a2");
    const emailB = uniqueEmail("b2");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategy = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const runB = await new BacktestRunRepository(db, userB).create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });

    const repositoryA = new BacktestRunRepository(db, userA);
    await expect(
      repositoryA.saveProgress(runB.id, {
        status: "paused",
        checkpoint: {
          schema: 1,
          engineVersion: "0.2.0",
          configDigest: "x",
          cursor: "2025-01-02",
          state: null,
        },
        configDigest: "x",
        sessionsDone: 1,
        sessionsTotal: 5,
      }),
    ).rejects.toBeInstanceOf(BacktestRunNotFoundError);

    await expect(repositoryA.fail(runB.id, "nope")).rejects.toBeInstanceOf(
      BacktestRunNotFoundError,
    );
  });

  it("user A cannot claim (read, write or trigger a job for) user B's backtest run (round 5 item 3)", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a3");
    const emailB = uniqueEmail("b3");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategy = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const runB = await new BacktestRunRepository(db, userB).create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });
    expect(runB.status).toBe("pending");

    await expect(new BacktestRunRepository(db, userA).claim(runB.id)).rejects.toBeInstanceOf(
      BacktestRunNotFoundError,
    );

    // Not just rejected: user B's own row must never have moved out of
    // "pending" (or picked up user A's claim) from the attempt.
    const stillB = await new BacktestRunRepository(db, userB).findMine(runB.id);
    expect(stillB.status).toBe("pending");
  });

  it("a completed run cannot be updated again, even by its own owner", async () => {
    const db = getDb();
    const email = uniqueEmail("owner");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const repository = new BacktestRunRepository(db, owner);
    const run = await repository.create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });

    await repository.complete(run.id, {
      result: completedResult(version),
      configDigest: "x",
      sessionsDone: 0,
    });

    await expect(repository.fail(run.id, "too late")).rejects.toBeInstanceOf(
      BacktestRunAlreadyCompleteError,
    );
  });

  it("claims a stale running run but rejects a fresh one still within its lease (round 2 item 2)", async () => {
    const db = getDb();
    const email = uniqueEmail("stale-lease");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const repository = new BacktestRunRepository(db, owner);
    const runInput = {
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn" as const,
      sizing: version.definition.sizing,
      seed: 1,
    };

    const staleRun = await repository.create(runInput);
    const freshRun = await repository.create(runInput);

    const checkpoint = {
      schema: 1 as const,
      engineVersion: "0.2.0",
      configDigest: "x",
      cursor: "2025-01-02",
      state: null,
    };

    await db
      .update(backtestRuns)
      .set({
        status: "running",
        checkpoint,
        updatedAt: new Date(Date.now() - STALE_LEASE_MS - 1_000),
      })
      .where(eq(backtestRuns.id, staleRun.id));

    await db
      .update(backtestRuns)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(backtestRuns.id, freshRun.id));

    const reclaimed = await repository.claim(staleRun.id);
    expect(reclaimed.status).toBe("running");
    expect(reclaimed.checkpoint).toEqual(checkpoint);

    await expect(repository.claim(freshRun.id)).rejects.toBeInstanceOf(BacktestRunClaimError);
  });

  it("reclaims a failed run so a retry has a path back in (round 2 item 12)", async () => {
    const db = getDb();
    const email = uniqueEmail("reclaim-failed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const repository = new BacktestRunRepository(db, owner);
    const run = await repository.create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });

    const checkpoint = {
      schema: 1 as const,
      engineVersion: "0.2.0",
      configDigest: "x",
      cursor: "2025-01-02",
      state: null,
    };
    await db
      .update(backtestRuns)
      .set({ status: "running", checkpoint })
      .where(eq(backtestRuns.id, run.id));

    await repository.fail(run.id, "data_version_changed");

    const reclaimed = await repository.claim(run.id);
    expect(reclaimed.status).toBe("running");
    expect(reclaimed.checkpoint).toEqual(checkpoint);
    // The previous failure's message must not survive into a row that goes
    // on to assert `status: "complete"` alongside it (round 3 item 6).
    expect(reclaimed.error).toBeNull();
  });

  it("lets exactly one of two racing completions through, the loser rejecting from the trigger itself, not a pre-check that got lucky (round 2 item 3, round 3 item 8)", async () => {
    const db = getDb();
    const email = uniqueEmail("race-complete");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const repository = new BacktestRunRepository(db, owner);
    const run = await repository.create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: ["ZQIS3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });

    const result = completedResult(version);

    // `guardedUpdate` reads before it writes, so two calls sharing one
    // pooled connection can serialise such that the loser's own read
    // already sees "complete" and rejects from the pre-check — the same
    // observable outcome as the trigger firing, but never exercising the
    // catch block round 2 item 3 added (round 3 item 8). An explicit
    // transaction on a second connection forces the real ordering instead:
    // held open past the loser's read (so its pre-check sees the row still
    // running) and past its UPDATE being sent (so that UPDATE blocks on the
    // winner's row lock), only then released, so the loser's write lands
    // after the row is already complete and the trigger — not the
    // pre-check — is what rejects it.
    let releaseWinner: (() => void) | undefined;
    const winnerMayCommit = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const winner = db.transaction(async (tx) => {
      await tx
        .update(backtestRuns)
        .set({
          status: "complete",
          result,
          configDigest: "x",
          sessionsDone: 0,
          sessionsTotal: 0,
          completedAt: new Date(),
        })
        .where(eq(backtestRuns.id, run.id));
      await winnerMayCommit;
    });

    const loser = (async () => {
      // Gives the winner's UPDATE time to land (uncommitted) before the
      // loser's own read runs, and gives the loser's read and its own
      // UPDATE send time to complete before the winner commits below.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return repository.complete(run.id, { result, configDigest: "x", sessionsDone: 0 });
    })();

    await new Promise((resolve) => setTimeout(resolve, 400));
    releaseWinner?.();

    const [winnerOutcome, loserOutcome] = await Promise.allSettled([winner, loser]);

    expect(winnerOutcome.status).toBe("fulfilled");
    if (loserOutcome.status !== "rejected") {
      throw new Error("expected the loser to reject");
    }
    expect(loserOutcome.reason).toBeInstanceOf(BacktestRunAlreadyCompleteError);
  });
});
