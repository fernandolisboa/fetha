import { afterEach, describe, expect, it } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";
import { StrategiesRepository } from "@/modules/strategies";

import {
  BacktestRunAlreadyCompleteError,
  BacktestRunNotFoundError,
  BacktestRunRepository,
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
      result: {
        config: {
          strategy: {
            id: version.id,
            definition: version.definition,
            structure: {
              id: "stock",
              name: "Compra de ação",
              expiry: "shared",
              legs: [{ role: "stock", side: "buy", ratio: 1 }],
            },
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
      },
      configDigest: "x",
      sessionsDone: 0,
    });

    await expect(repository.fail(run.id, "too late")).rejects.toBeInstanceOf(
      BacktestRunAlreadyCompleteError,
    );
  });
});
