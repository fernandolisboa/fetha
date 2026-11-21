import { afterEach, describe, expect, it } from "vitest";
import type { ContemplatedLeg, PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { PortfolioRepository } from "@/modules/portfolio";
import { contemplatedOperations, operations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { PlanRulesRepository } from "./plan-rules-repository";

function uniqueEmail(label: string): string {
  return `fetha-ungroup-unlinks-plan-${label}-${crypto.randomUUID()}@example.com`;
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

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

// A plan-linked operation has no decisions against it (the only other reason `ungroup` refuses),
// so it must be ungroupable: the FK's own `ON DELETE SET NULL ("operation_id")` unlinks the plan
// instead of a 23503 escaping (review round 2, #381 — see docs/adr/0079 addendum).
describe("ungrouping a plan-linked operation", () => {
  it("unlinks the plan instead of failing, leaving it executable again", async () => {
    await ensureStockStructure();
    const db = getDb();
    const email = uniqueEmail("ok");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const [operation] = await db
      .insert(operations)
      .values({ userId: owner.id, underlying: "PETR4", status: "open", openedAt: "2027-01-02" })
      .returning({ id: operations.id });
    if (!operation) throw new Error("failed to insert operation");

    const legs: ContemplatedLeg[] = [
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
    ];
    const [contemplated] = await db
      .insert(contemplatedOperations)
      .values({
        userId: owner.id,
        structureId: "stock",
        underlying: "PETR4",
        legs,
        session: "2027-01-02",
        netPremiumCentavos: 100000,
        maxLossCentavos: 100000,
        maxGainCentavos: null,
        breachedLimits: [],
      })
      .returning({ id: contemplatedOperations.id });
    if (!contemplated) throw new Error("failed to insert contemplated operation");

    const planRulesRepo = new PlanRulesRepository(db, owner);
    await planRulesRepo.save({
      contemplatedOperationId: contemplated.id,
      recipeId: "buy-and-hold",
      rules: fixtureRules(),
    });
    const linked = await planRulesRepo.linkOperation(contemplated.id, operation.id);
    expect(linked.ok).toBe(true);
    expect((await planRulesRepo.findByOperation(contemplated.id))?.operationId).toBe(operation.id);

    const ungrouped = await new PortfolioRepository(db, owner).ungroup(operation.id);
    expect(ungrouped).toEqual({ ok: true });

    const afterUngroup = await planRulesRepo.findByOperation(contemplated.id);
    expect(afterUngroup?.operationId).toBeNull();
  });
});
