import { afterEach, describe, expect, it, vi } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { BacktestRunRepository } from "@/modules/backtests/backtest-run-repository";
import { DEFAULT_COST_MODEL, defaultRiskProfile } from "@/modules/backtests/default-config";
import { StrategiesRepository } from "@/modules/strategies";

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
    name: "Estratégia de isolamento da rota",
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
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

function uniqueEmail(label: string): string {
  return `fetha-backtest-run-route-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<CurrentUser> {
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

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("POST /api/backtests/[id]/run", () => {
  it("rate limits after 6 requests in the window, the 7th POST returns 429 (round 2 item 5)", async () => {
    vi.resetModules();
    const { POST } = await import("./route");

    const email = uniqueEmail("rate-limit");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const call = (): Promise<Response> =>
      POST(new Request("http://localhost/api/backtests/does-not-exist/run", { method: "POST" }), {
        params: Promise.resolve({ id: "does-not-exist" }),
      });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await call();
      // The run does not exist, so every one of the first 6 calls reaches
      // (and consumes) the rate limit before failing on that later,
      // unrelated 404.
      expect(response.status).toBe(404);
    }

    const seventh = await call();
    expect(seventh.status).toBe(429);
    await expect(seventh.json()).resolves.toEqual({ ok: false, error: "rate_limited" });
  });

  it("returns 404 for user A's POST against user B's run, with no status change on B's row (round 5 item 3)", async () => {
    vi.resetModules();
    const { POST } = await import("./route");

    const db = getDb();
    const emailA = uniqueEmail("cross-user-a");
    const emailB = uniqueEmail("cross-user-b");
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
      universe: ["ZQRT3"],
      period: { from: "2025-01-02", to: "2025-01-10" },
      initialCapital: centavos(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: defaultRiskProfile(centavos(1_000_000)),
      limits: "warn",
      sizing: version.definition.sizing,
      seed: 1,
    });
    expect(runB.status).toBe("pending");

    currentUser = userA;
    const response = await POST(
      new Request(`http://localhost/api/backtests/${runB.id}/run`, { method: "POST" }),
      { params: Promise.resolve({ id: runB.id }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "not_found" });

    const stillB = await new BacktestRunRepository(db, userB).findMine(runB.id);
    expect(stillB.status).toBe("pending");
  });
});
