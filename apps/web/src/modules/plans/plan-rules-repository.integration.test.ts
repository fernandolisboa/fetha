import { afterEach, describe, expect, it } from "vitest";
import type { ContemplatedLeg, PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { structures } from "@/modules/strategies/schema";
import { contemplatedOperations, operations } from "@/modules/portfolio/schema";

import { PlanRulesRepository } from "./plan-rules-repository";

function uniqueEmail(label: string): string {
  return `fetha-plan-rules-${label}-${crypto.randomUUID()}@example.com`;
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

async function insertContemplatedOperation(userId: string): Promise<string> {
  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
  ];
  const [row] = await getDb()
    .insert(contemplatedOperations)
    .values({
      userId,
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
  if (!row) throw new Error("failed to insert contemplated operation");
  return row.id;
}

function fixtureRules(): PlanRules {
  return {
    recipeId: "bull-call-spread-low-iv",
    summary: "A Fetha montou essa trava de alta em PETR4.",
    exitRules: [{ rule: { kind: "days_before_expiry", businessDays: 5 }, session: "2027-01-09" }],
    roll: { applies: false, session: null },
    original: {
      legs: [
        { role: "call", side: "buy", ticker: "PETRC100", quantity: 100 as never },
        { role: "call", side: "sell", ticker: "PETRC110", quantity: 100 as never },
      ],
      lots: 1,
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

describe("PlanRulesRepository isolation", () => {
  it("user A cannot read user B's plan rules by their contemplated operation id", async () => {
    await ensureStockStructure();
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const operationA = await insertContemplatedOperation(userA.id);
    const operationB = await insertContemplatedOperation(userB.id);

    await new PlanRulesRepository(db, userA).save({
      contemplatedOperationId: operationA,
      recipeId: "bull-call-spread-low-iv",
      rules: fixtureRules(),
    });
    await new PlanRulesRepository(db, userB).save({
      contemplatedOperationId: operationB,
      recipeId: "bear-put-spread-low-iv",
      rules: { ...fixtureRules(), recipeId: "bear-put-spread-low-iv" },
    });

    const asUserA = new PlanRulesRepository(db, userA);
    expect(await asUserA.findByOperation(operationA)).not.toBeNull();
    // User A naming user B's own operation id finds nothing: the row exists, scoped to B.
    expect(await asUserA.findByOperation(operationB)).toBeNull();

    const onlyB = await new PlanRulesRepository(db, userB).listMine();
    expect(onlyB).toHaveLength(1);
    expect(onlyB[0]?.recipeId).toBe("bear-put-spread-low-iv");
  });

  it("cannot save plan rules against another user's contemplated operation", async () => {
    await ensureStockStructure();
    const db = getDb();
    const emailA = uniqueEmail("cross-save-a");
    const emailB = uniqueEmail("cross-save-b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const operationB = await insertContemplatedOperation(userB.id);

    await expect(
      new PlanRulesRepository(db, userA).save({
        contemplatedOperationId: operationB,
        recipeId: "bull-call-spread-low-iv",
        rules: fixtureRules(),
      }),
    ).rejects.toThrow();
  });

  it("cannot link a plan to another user's operation (write isolation, #381)", async () => {
    await ensureStockStructure();
    const db = getDb();
    const emailA = uniqueEmail("cross-link-a");
    const emailB = uniqueEmail("cross-link-b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const operationA = await insertContemplatedOperation(userA.id);
    await new PlanRulesRepository(db, userA).save({
      contemplatedOperationId: operationA,
      recipeId: "bull-call-spread-low-iv",
      rules: fixtureRules(),
    });
    const [operationB] = await db
      .insert(operations)
      .values({ userId: userB.id, underlying: "PETR4", status: "open", openedAt: "2027-01-02" })
      .returning({ id: operations.id });
    if (!operationB) throw new Error("failed to insert operation");

    // The composite FK, not only this repository's own scoping, refuses it: `operation_id`
    // alone could be forged by any authenticated caller, the pair `(operation_id, user_id)`
    // cannot.
    await expect(
      new PlanRulesRepository(db, userA).linkOperation(operationA, operationB.id),
    ).rejects.toThrow();

    const stillUnlinked = await new PlanRulesRepository(db, userA).findByOperation(operationA);
    expect(stillUnlinked?.operationId).toBeNull();
  });

  it("returns null and an empty list before any plan is saved", async () => {
    const db = getDb();
    const email = uniqueEmail("none");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    expect(await new PlanRulesRepository(db, testUser).findByOperation("missing")).toBeNull();
    expect(await new PlanRulesRepository(db, testUser).listMine()).toEqual([]);
  });
});
