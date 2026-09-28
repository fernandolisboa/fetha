import { afterEach, describe, expect, it, vi } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { BacktestRun } from "@fetha/engine";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { StrategiesRepository } from "@/modules/strategies";

import { BacktestRunRepository } from "./backtest-run-repository";
import { DEFAULT_COST_MODEL, defaultRiskProfile } from "./default-config";
import { getMyActiveBacktestRuns, getMyComparison } from "./queries";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
  };
});

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

function definition(): StrategyDefinition {
  return {
    name: "Arquivada com runs",
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

function runConfig(version: { id: string; definition: StrategyDefinition }) {
  return {
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
}

function runInput(version: { id: string; definition: StrategyDefinition }, strategyId: string) {
  return {
    strategyId,
    strategyVersionId: version.id,
    structure: STOCK_STRUCTURE,
    ...runConfig(version),
  };
}

function completedResult(version: { id: string; definition: StrategyDefinition }): BacktestRun {
  return {
    config: {
      ...runConfig(version),
      strategy: { id: version.id, definition: version.definition, structure: STOCK_STRUCTURE },
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

async function signIn(label: string): Promise<CurrentUser> {
  const email = `fetha-backtest-queries-${label}-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
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
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) throw new Error("expected a user");
  currentUser = row;
  return row;
}

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("backtest read models of an archived strategy (#170, docs/adr/0043)", () => {
  it("still names the strategy of a run in progress after it is archived", async () => {
    const owner = await signIn("active");
    const db = getDb();
    const strategies = new StrategiesRepository(db, owner);
    const strategy = await strategies.createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");
    const run = await new BacktestRunRepository(db, owner).create(runInput(version, strategy.id));
    await strategies.archive(strategy.id);

    const active = await getMyActiveBacktestRuns();

    expect(active).toEqual([
      expect.objectContaining({ id: run.id, strategyName: "Arquivada com runs" }),
    ]);
  });

  it("still names the strategy of completed runs in the comparison after it is archived", async () => {
    const owner = await signIn("comparison");
    const db = getDb();
    const strategies = new StrategiesRepository(db, owner);
    const strategy = await strategies.createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");
    const runs = new BacktestRunRepository(db, owner);
    const first = await runs.create(runInput(version, strategy.id));
    const second = await runs.create(runInput(version, strategy.id));
    for (const run of [first, second]) {
      await runs.complete(run.id, {
        result: completedResult(version),
        configDigest: "x",
        sessionsDone: 0,
      });
    }
    await strategies.archive(strategy.id);

    const comparison = await getMyComparison([first.id, second.id]);

    expect(comparison.groups).toEqual([
      expect.objectContaining({ strategyId: strategy.id, strategyName: "Arquivada com runs" }),
    ]);
  });
});
