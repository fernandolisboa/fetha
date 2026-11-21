import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type ContemplatedLeg,
  type PlanRules,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { contemplatedOperations, operations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { PlanRulesRepository } from "./plan-rules-repository";
import { PlanSignalsRepository } from "./plan-signals-repository";

let currentUser: CurrentUser | null = null;

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(currentUser);
    },
  };
});

const { getMyPlanSignals } = await import("./plan-signals-queries");

function uniqueEmail(label: string): string {
  return `fetha-plan-signals-queries-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

async function ensureStockStructure(): Promise<void> {
  await getDb()
    .insert(structures)
    .values({
      id: "stock",
      name: "Compra de ação",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    })
    .onConflictDoNothing();
}

function fixtureRules(): PlanRules {
  return {
    recipeId: "buy-and-hold",
    summary: "A Fetha montou essa posição.",
    exitRules: [
      {
        rule: { kind: "profit_target", fractionOfPremium: decimalStringSchema.parse("0.5") },
        session: null,
      },
    ],
    roll: { applies: false, session: null },
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

interface SignaledOperationFixture {
  owner: CurrentUser;
  operationId: string;
  underlying: string;
}

// One contemplated operation, linked to a real portfolio operation of the given `status`, with
// a single `target_hit` plan signal already written for it (ticket #381, review round 2
// correctness finding): exercises `getMyPlanSignals`'s own join against `getMyPortfolio`'s open
// operations without needing the engine's real pricing path.
async function setupSignaledOperation(
  emailLabel: string,
  status: "open" | "closed",
): Promise<SignaledOperationFixture> {
  await ensureStockStructure();
  const db = getDb();
  const email = uniqueEmail(emailLabel);
  createdEmails.push(email);
  const owner = await insertBareUser(email);

  const underlying = tickerSchema.parse(
    `Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}3`,
  );
  const session = sessionDateSchema.parse("2024-01-02");

  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: underlying, quantity: 100 } as ContemplatedLeg,
  ];
  const [contemplated] = await db
    .insert(contemplatedOperations)
    .values({
      userId: owner.id,
      structureId: "stock",
      underlying,
      legs,
      session,
      netPremiumCentavos: 300000,
      maxLossCentavos: 300000,
      maxGainCentavos: null,
      breachedLimits: [],
    })
    .returning({ id: contemplatedOperations.id });
  if (!contemplated) throw new Error("failed to insert contemplated operation");

  const planRules = new PlanRulesRepository(db, owner);
  const saved = await planRules.save({
    contemplatedOperationId: contemplated.id,
    recipeId: "buy-and-hold",
    rules: fixtureRules(),
  });

  const [operation] = await db
    .insert(operations)
    .values({
      userId: owner.id,
      underlying,
      status,
      openedAt: session,
      closedAt: status === "closed" ? session : null,
    })
    .returning({ id: operations.id });
  if (!operation) throw new Error("failed to insert operation");

  const linked = await planRules.linkOperation(contemplated.id, operation.id);
  if (!linked.ok) throw new Error("failed to link plan to operation");

  await new PlanSignalsRepository(db, owner).createMany([
    {
      operationPlanRulesId: saved.id,
      operationId: operation.id,
      kind: "target_hit",
      session,
      at: instantSchema.parse(`${session}T20:00:00.000Z`),
    },
  ]);

  return { owner, operationId: operation.id, underlying };
}

describe("getMyPlanSignals", () => {
  it("shows a target_hit alert for a still-open linked operation", async () => {
    const { owner, operationId, underlying } = await setupSignaledOperation("open", "open");
    currentUser = owner;

    const signals = await getMyPlanSignals();

    expect(signals).toEqual([
      expect.objectContaining({ kind: "target_hit", operationId, underlying }),
    ]);
  });

  // #381 review round 2 correctness finding: `getMyPortfolio` returns every operation
  // regardless of status, so without this filter a closed operation's alert would keep
  // rendering on /sinais until the next nightly run clears it.
  it("hides an alert for an operation that is no longer open", async () => {
    const { owner } = await setupSignaledOperation("closed", "closed");
    currentUser = owner;

    const signals = await getMyPlanSignals();

    expect(signals).toEqual([]);
  });
});
