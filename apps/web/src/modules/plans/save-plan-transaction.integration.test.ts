import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { ContemplatedLeg, PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { contemplatedOperations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { operationPlanRules } from "./schema";

function uniqueEmail(label: string): string {
  return `fetha-save-plan-tx-${label}-${crypto.randomUUID()}@example.com`;
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
    recipeId: "bull-call-spread-low-iv",
    summary: "A Fetha montou essa trava de alta em PETR4.",
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

// Exercises the exact shape `savePlanAction` writes (apps/web/src/modules/plans/actions.ts,
// ADR-0079): a contemplated operation and this plan's own rules, inserted together in one
// transaction against raw `tx` queries, the same pattern `PortfolioRepository`'s own multi-step
// writes use.
describe("saving a plan", () => {
  it("writes the contemplated operation and its plan rules together", async () => {
    await ensureStockStructure();
    const db = getDb();
    const email = uniqueEmail("ok");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const legs: ContemplatedLeg[] = [
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
    ];

    const operationId = await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(contemplatedOperations)
        .values({
          userId: owner.id,
          structureId: "stock",
          underlying: "PETR4",
          legs,
          session: "2027-01-02",
          netPremiumCentavos: 100,
          maxLossCentavos: 100,
          maxGainCentavos: null,
          breachedLimits: [],
        })
        .returning({ id: contemplatedOperations.id });
      if (!saved) throw new Error("failed to save contemplated operation");
      await tx.insert(operationPlanRules).values({
        userId: owner.id,
        contemplatedOperationId: saved.id,
        recipeId: "bull-call-spread-low-iv",
        rules: fixtureRules(),
      });
      return saved.id;
    });

    const [operationRow] = await db
      .select()
      .from(contemplatedOperations)
      .where(eq(contemplatedOperations.id, operationId));
    expect(operationRow).toBeDefined();

    const [rulesRow] = await db
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.contemplatedOperationId, operationId));
    expect(rulesRow?.recipeId).toBe("bull-call-spread-low-iv");
  });

  it("rolls back the contemplated operation when the plan rules insert fails", async () => {
    await ensureStockStructure();
    const db = getDb();
    const email = uniqueEmail("rollback");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const legs: ContemplatedLeg[] = [
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
    ];

    await expect(
      db.transaction(async (tx) => {
        const [saved] = await tx
          .insert(contemplatedOperations)
          .values({
            userId: owner.id,
            structureId: "stock",
            underlying: "PETR4",
            legs,
            session: "2027-01-02",
            netPremiumCentavos: 100,
            maxLossCentavos: 100,
            maxGainCentavos: null,
            breachedLimits: [],
          })
          .returning({ id: contemplatedOperations.id });
        if (!saved) throw new Error("failed to save contemplated operation");
        // A foreign user id on the rules row violates the composite FK (user A cannot write a
        // plan's rules onto a row owned by someone else, the same guarantee the isolation test
        // in plan-rules-repository.integration.test.ts asserts for a direct save).
        await tx.insert(operationPlanRules).values({
          userId: crypto.randomUUID(),
          contemplatedOperationId: saved.id,
          recipeId: "bull-call-spread-low-iv",
          rules: fixtureRules(),
        });
        return saved.id;
      }),
    ).rejects.toThrow();

    const rows = await db
      .select()
      .from(contemplatedOperations)
      .where(eq(contemplatedOperations.userId, owner.id));
    expect(rows).toHaveLength(0);
  });
});
