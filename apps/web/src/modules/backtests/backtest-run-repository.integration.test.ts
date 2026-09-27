import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { BacktestRun } from "@fetha/engine";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { backtestRuns } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { loadMigrationStatements } from "@/db/test/migration-sql";
import { StrategiesRepository } from "@/modules/strategies";

import {
  ActiveBacktestRunLimitError,
  BacktestRunAlreadyCompleteError,
  BacktestRunClaimError,
  BacktestRunNotFoundError,
  BacktestRunRepository,
  MAX_ACTIVE_BACKTEST_RUNS,
  STALE_LEASE_MS,
} from "./backtest-run-repository";
import { DEFAULT_COST_MODEL, defaultRiskProfile } from "./default-config";
import { DISCARDED_RUN_ERROR } from "./run-status";

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
      walkForward: null,
      seed: 1,
    });

    await expect(new BacktestRunRepository(db, userA).findMine(runB.id)).rejects.toBeInstanceOf(
      BacktestRunNotFoundError,
    );
  });

  it("a comparison lists and reads only the user's own completed runs (#30)", async () => {
    const db = getDb();
    const emailA = uniqueEmail("compare-a");
    const emailB = uniqueEmail("compare-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    async function completedRunOf(owner: { id: string; name: string; email: string }) {
      const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
      const version = strategy.versions[0];
      if (!version) throw new Error("expected a version");
      const repository = new BacktestRunRepository(db, owner);
      const input = {
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
        walkForward: { windowSessions: 63 },
        seed: 1,
      };
      const complete = await repository.create(input);
      await repository.complete(complete.id, {
        result: completedResult(version),
        configDigest: "x",
        sessionsDone: 0,
      });
      const pending = await repository.create(input);
      return { complete, pending };
    }

    const a = await completedRunOf(userA);
    const b = await completedRunOf(userB);
    const repositoryA = new BacktestRunRepository(db, userA);

    const summaries = await repositoryA.listMineCompleteSummaries();
    expect(summaries.map((summary) => summary.id)).toEqual([a.complete.id]);

    const read = await repositoryA.findMineComplete([b.complete.id, a.pending.id, a.complete.id]);
    expect(read.map((run) => run.id)).toEqual([a.complete.id]);
    expect(read[0]?.walkForward).toEqual({ windowSessions: 63 });
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
      walkForward: null,
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
      walkForward: null,
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
      walkForward: null,
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
      walkForward: null,
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
      walkForward: null,
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
      walkForward: null,
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

describe("backtest_runs #73 optionPerContract -> optionPerOrder migration (0016_option_per_order)", () => {
  it("migrates a row stored under the old key in cost_model and result.config.costModel, then reads it back through the repository", async () => {
    const db = getDb();
    const email = uniqueEmail("migration-73");
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
      walkForward: null,
      seed: 1,
    });

    const oldShapeCostModel = {
      b3FeeRate: DEFAULT_COST_MODEL.b3FeeRate,
      brokerage: {
        stockPerOrder: DEFAULT_COST_MODEL.brokerage.stockPerOrder,
        optionPerContract: DEFAULT_COST_MODEL.brokerage.optionPerOrder,
      },
      optionSlippageRate: DEFAULT_COST_MODEL.optionSlippageRate,
      incomeTaxRate: DEFAULT_COST_MODEL.incomeTaxRate,
      monthlyStockSalesExemption: DEFAULT_COST_MODEL.monthlyStockSalesExemption,
    };
    const oldShapeResult = completedResult(version) as unknown as {
      config: { costModel: unknown };
    };
    oldShapeResult.config.costModel = oldShapeCostModel;

    // Raw SQL, bypassing the typed repository and its strict Zod schemas
    // entirely: this reproduces exactly the pre-#73 on-disk shape (the old
    // key name), which the current schema would refuse to parse.
    await db.execute(sql`
      update backtest_runs
      set cost_model = ${JSON.stringify(oldShapeCostModel)}::jsonb,
          status = 'complete',
          config_digest = 'x',
          sessions_done = 0,
          completed_at = now(),
          result = ${JSON.stringify(oldShapeResult)}::jsonb
      where id = ${run.id}
    `);

    await db.transaction(async (tx) => {
      for (const statement of loadMigrationStatements("0016_option_per_order")) {
        await tx.execute(sql.raw(statement));
      }
    });

    const migrated = await repository.findMine(run.id);
    const preAdr0040CostModel = {
      b3FeeRate: DEFAULT_COST_MODEL.b3FeeRate,
      brokerage: DEFAULT_COST_MODEL.brokerage,
      optionSlippageRate: DEFAULT_COST_MODEL.optionSlippageRate,
      incomeTaxRate: DEFAULT_COST_MODEL.incomeTaxRate,
      monthlyStockSalesExemption: DEFAULT_COST_MODEL.monthlyStockSalesExemption,
    };
    expect(migrated.costModel).toEqual(preAdr0040CostModel);
    expect(migrated.result?.config.costModel).toEqual(preAdr0040CostModel);

    const { rows } = await db.execute(
      sql`select cost_model, result from backtest_runs where id = ${run.id}`,
    );
    const [raw] = rows;
    if (!raw) throw new Error("expected the migrated row");
    expect((raw as { cost_model: { brokerage: object } }).cost_model.brokerage).not.toHaveProperty(
      "optionPerContract",
    );
    expect(
      (raw as { result: { config: { costModel: { brokerage: object } } } }).result.config.costModel
        .brokerage,
    ).not.toHaveProperty("optionPerContract");
  });
});

describe("BacktestRunRepository active-run cap (#147)", () => {
  async function setUp(label: string) {
    const db = getDb();
    const email = uniqueEmail(label);
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");
    const input = {
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
      walkForward: { windowSessions: 63 },
      seed: 1,
    };
    return { owner, repository: new BacktestRunRepository(db, owner), input, version };
  }

  it("refuses a run beyond the cap until one of the user's runs completes", async () => {
    const mine = await setUp("cap");
    const other = await setUp("cap-other");

    const runs = [];
    for (let i = 0; i < MAX_ACTIVE_BACKTEST_RUNS; i += 1) {
      runs.push(await mine.repository.create(mine.input));
    }
    await expect(mine.repository.create(mine.input)).rejects.toBeInstanceOf(
      ActiveBacktestRunLimitError,
    );
    await expect(other.repository.create(other.input)).resolves.toMatchObject({
      status: "pending",
    });

    const [first] = runs;
    if (!first) throw new Error("expected a run");
    await mine.repository.complete(first.id, {
      result: completedResult(mine.version),
      configDigest: "x",
      sessionsDone: 0,
    });
    await expect(mine.repository.create(mine.input)).resolves.toMatchObject({
      status: "pending",
    });
  });

  it("resumes a failed run only while the user is under the cap", async () => {
    const { repository, input, version } = await setUp("claim-failed");

    const failed = await repository.create(input);
    await repository.claim(failed.id);
    await repository.fail(failed.id, "no_market_data");
    const first = await repository.create(input);
    await repository.create(input);

    await expect(repository.claim(failed.id)).rejects.toBeInstanceOf(ActiveBacktestRunLimitError);
    await expect(repository.claim(first.id)).resolves.toMatchObject({ status: "running" });

    await repository.complete(first.id, {
      result: completedResult(version),
      configDigest: "x",
      sessionsDone: 0,
    });
    await expect(repository.claim(failed.id)).resolves.toMatchObject({ status: "running" });
  });

  it("waits for the per-user lock before counting", async () => {
    const db = getDb();
    const { owner, repository, input } = await setUp("lock");

    let created: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`backtest_runs:${owner.id}`}, 0))`,
      );
      created = repository.create(input);
      const outcome = await Promise.race([
        created.then(() => "created"),
        new Promise((resolve) => {
          setTimeout(() => {
            resolve("waiting");
          }, 500);
        }),
      ]);
      expect(outcome).toBe("waiting");
    });
    await expect(created).resolves.toMatchObject({ status: "pending" });
  });

  it("admits at most the cap when creates race", async () => {
    const { repository, input } = await setUp("race");

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => repository.create(input)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      MAX_ACTIVE_BACKTEST_RUNS,
    );
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ActiveBacktestRunLimitError);
      }
    }
  });
});

describe("BacktestRunRepository discard (#159)", () => {
  async function setUp(label: string) {
    const db = getDb();
    const email = uniqueEmail(label);
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");
    const input = {
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
      walkForward: { windowSessions: 63 },
      seed: 1,
    };
    return { owner, repository: new BacktestRunRepository(db, owner), input, version };
  }

  it.each(["pending", "paused", "running", "stale-running"] as const)(
    "discarding a %s run frees an active-cap slot",
    async (variant) => {
      const db = getDb();
      const { repository, input } = await setUp(`discard-cap-${variant}`);

      const runs = [];
      for (let i = 0; i < MAX_ACTIVE_BACKTEST_RUNS; i += 1) {
        runs.push(await repository.create(input));
      }
      await expect(repository.create(input)).rejects.toBeInstanceOf(ActiveBacktestRunLimitError);

      const [toDiscard] = runs;
      if (!toDiscard) throw new Error("expected a run");

      if (variant === "paused") {
        await repository.claim(toDiscard.id);
        await repository.saveProgress(toDiscard.id, {
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
        });
      } else if (variant === "running") {
        await repository.claim(toDiscard.id);
      } else if (variant === "stale-running") {
        // A "running" row orphaned past its own lease (STALE_LEASE_MS): the
        // slot it holds must still be freed by a discard, the way the
        // ticket's own residual (a stuck run held its slot until the lease
        // expired) motivated this feature in the first place.
        await db
          .update(backtestRuns)
          .set({ status: "running", updatedAt: new Date(Date.now() - STALE_LEASE_MS - 1_000) })
          .where(eq(backtestRuns.id, toDiscard.id));
      }

      const result = await repository.discard(toDiscard.id);
      expect(result).toMatchObject({ status: "discarded", run: { status: "failed" } });
      if (result.status !== "discarded") throw new Error("expected discarded");
      expect(result.run.error).toBe(DISCARDED_RUN_ERROR);

      await expect(repository.create(input)).resolves.toMatchObject({ status: "pending" });
    },
  );

  it("refuses to discard a completed run", async () => {
    const { repository, input, version } = await setUp("discard-complete");
    const run = await repository.create(input);
    await repository.complete(run.id, {
      result: completedResult(version),
      configDigest: "x",
      sessionsDone: 0,
    });

    await expect(repository.discard(run.id)).resolves.toEqual({ status: "not_discardable" });
    const still = await repository.findMine(run.id);
    expect(still.status).toBe("complete");
  });

  it("refuses to discard an already-failed run", async () => {
    const { repository, input } = await setUp("discard-failed");
    const run = await repository.create(input);
    await repository.claim(run.id);
    await repository.fail(run.id, "no_market_data");

    await expect(repository.discard(run.id)).resolves.toEqual({ status: "not_discardable" });
    const still = await repository.findMine(run.id);
    expect(still.status).toBe("failed");
    expect(still.error).toBe("no_market_data");
  });

  it("user A cannot discard user B's run", async () => {
    const a = await setUp("discard-a");
    const b = await setUp("discard-b");
    const runB = await b.repository.create(b.input);

    await expect(a.repository.discard(runB.id)).rejects.toBeInstanceOf(BacktestRunNotFoundError);

    const stillB = await b.repository.findMine(runB.id);
    expect(stillB.status).toBe("pending");
  });

  it("user A does not see user B's active runs in listMineActive", async () => {
    const a = await setUp("discard-list-a");
    const b = await setUp("discard-list-b");
    await a.repository.create(a.input);
    await b.repository.create(b.input);

    const activeA = await a.repository.listMineActive();
    expect(activeA).toHaveLength(1);
    expect(activeA[0]?.strategyId).toBe(a.input.strategyId);
  });

  it("a chunk that persists progress after a discard does not revive the run", async () => {
    const { repository, input, version } = await setUp("discard-revive");
    const run = await repository.create(input);
    await repository.claim(run.id);

    const discarded = await repository.discard(run.id);
    expect(discarded.status).toBe("discarded");

    await expect(
      repository.saveProgress(run.id, {
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
    ).rejects.toBeInstanceOf(BacktestRunClaimError);

    await expect(
      repository.complete(run.id, {
        result: completedResult(version),
        configDigest: "x",
        sessionsDone: 0,
      }),
    ).rejects.toBeInstanceOf(BacktestRunClaimError);

    const final = await repository.findMine(run.id);
    expect(final.status).toBe("failed");
    expect(final.error).toBe(DISCARDED_RUN_ERROR);
  });

  it("claim() cannot resume a discarded run", async () => {
    const { repository, input } = await setUp("discard-claim");
    const run = await repository.create(input);
    await repository.claim(run.id);
    await repository.discard(run.id);

    await expect(repository.claim(run.id)).rejects.toBeInstanceOf(BacktestRunClaimError);

    const still = await repository.findMine(run.id);
    expect(still.status).toBe("failed");
    expect(still.error).toBe(DISCARDED_RUN_ERROR);
  });

  it("claim() of a discarded run at the cap raises BacktestRunClaimError, not ActiveBacktestRunLimitError", async () => {
    const { repository, input } = await setUp("discard-claim-cap");

    const first = await repository.create(input);
    await repository.create(input);
    await repository.claim(first.id);
    await repository.discard(first.id);
    // Re-fills the slot the discard just freed: the user is back at the cap
    // with `first` sitting discarded among their runs, the exact situation
    // that made `claim()` reach `enforceActiveCap` before checking whether
    // the row was discarded at all, answering the wrong error.
    await repository.create(input);

    await expect(repository.claim(first.id)).rejects.toBeInstanceOf(BacktestRunClaimError);
  });

  it("a failed row with a null error stays writable and claimable, not mistaken for a discard (NULL-safety)", async () => {
    const db = getDb();
    const { repository, input } = await setUp("discard-null-error");
    const run = await repository.create(input);

    await db
      .update(backtestRuns)
      .set({ status: "failed", error: null })
      .where(eq(backtestRuns.id, run.id));

    const reclaimed = await repository.claim(run.id);
    expect(reclaimed.status).toBe("running");

    await db
      .update(backtestRuns)
      .set({ status: "failed", error: null })
      .where(eq(backtestRuns.id, run.id));

    // guardedUpdate's own WHERE guard, not claimRow's: `fail()` must still
    // succeed against a `failed` row whose `error` is NULL, the exact shape
    // a plain `<>`/`!=` comparison (instead of `IS DISTINCT FROM`) would
    // silently exclude from the UPDATE and answer BacktestRunClaimError for.
    const updated = await repository.fail(run.id, "no_market_data");
    expect(updated.status).toBe("failed");
    expect(updated.error).toBe("no_market_data");
  });
});
