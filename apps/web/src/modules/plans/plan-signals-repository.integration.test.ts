import { afterEach, describe, expect, it } from "vitest";
import type { ContemplatedLeg, PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { contemplatedOperations, operations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { PlanRulesRepository } from "./plan-rules-repository";
import { PlanSignalsRepository } from "./plan-signals-repository";

function uniqueEmail(label: string): string {
  return `fetha-plan-signals-${label}-${crypto.randomUUID()}@example.com`;
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
    exitRules: [{ rule: { kind: "days_before_expiry", businessDays: 5 }, session: "2027-01-09" }],
    roll: { applies: false, session: null },
  };
}

async function insertExecutedPlan(
  userId: string,
): Promise<{ planRulesId: string; operationId: string }> {
  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
  ];
  const [operation] = await getDb()
    .insert(operations)
    .values({ userId, underlying: "PETR4", status: "open", openedAt: "2024-01-02" })
    .returning({ id: operations.id });
  if (!operation) throw new Error("failed to insert operation");
  const [contemplated] = await getDb()
    .insert(contemplatedOperations)
    .values({
      userId,
      structureId: "stock",
      underlying: "PETR4",
      legs,
      session: "2024-01-02",
      netPremiumCentavos: 300000,
      maxLossCentavos: 300000,
      maxGainCentavos: null,
      breachedLimits: [],
    })
    .returning({ id: contemplatedOperations.id });
  if (!contemplated) throw new Error("failed to insert contemplated operation");
  const { id: planRulesId } = await new PlanRulesRepository(getDb(), { id: userId }).save({
    contemplatedOperationId: contemplated.id,
    recipeId: "buy-and-hold",
    rules: fixtureRules(),
  });
  const linked = await new PlanRulesRepository(getDb(), { id: userId }).linkOperation(
    contemplated.id,
    operation.id,
  );
  if (!linked.ok) throw new Error("failed to link operation");
  return { planRulesId, operationId: operation.id };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("PlanSignalsRepository isolation", () => {
  it("user A cannot read user B's plan signals", async () => {
    await ensureStockStructure();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const planA = await insertExecutedPlan(userA.id);
    const planB = await insertExecutedPlan(userB.id);

    await new PlanSignalsRepository(getDb(), userA).createMany([
      {
        operationPlanRulesId: planA.planRulesId,
        operationId: planA.operationId,
        kind: "target_hit",
        session: "2024-01-03",
        at: "2024-01-03T20:00:00.000Z",
      },
    ]);
    await new PlanSignalsRepository(getDb(), userB).createMany([
      {
        operationPlanRulesId: planB.planRulesId,
        operationId: planB.operationId,
        kind: "stop_hit",
        session: "2024-01-03",
        at: "2024-01-03T20:00:00.000Z",
      },
    ]);

    const asUserA = await new PlanSignalsRepository(getDb(), userA).listMine();
    expect(asUserA).toHaveLength(1);
    expect(asUserA[0]).toMatchObject({ kind: "target_hit", operationId: planA.operationId });

    const asUserB = await new PlanSignalsRepository(getDb(), userB).listMine();
    expect(asUserB).toHaveLength(1);
    expect(asUserB[0]).toMatchObject({ kind: "stop_hit", operationId: planB.operationId });

    expect(
      await new PlanSignalsRepository(getDb(), userA).findMine(asUserB[0]?.id ?? ""),
    ).toBeNull();
  });

  it("deduplicates: a condition that is still true the next night writes nothing new", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("dedupe");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const plan = await insertExecutedPlan(owner.id);
    const repository = new PlanSignalsRepository(getDb(), owner);

    const row = {
      operationPlanRulesId: plan.planRulesId,
      operationId: plan.operationId,
      kind: "roll_due" as const,
      session: "2024-01-03",
      at: "2024-01-03T20:00:00.000Z",
    };
    expect(await repository.createMany([row])).toBe(1);
    expect(await repository.createMany([{ ...row, session: "2024-01-04" }])).toBe(0);
    expect(await repository.listMine()).toHaveLength(1);
  });
});
