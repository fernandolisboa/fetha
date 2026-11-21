import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import { decimalStringSchema, type ContemplatedLeg, type PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { contemplatedOperations, fills, operations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { operationPlanRules } from "./schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(currentUser);
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/modules/market-data", async () => {
  const actual =
    await vi.importActual<typeof import("@/modules/market-data")>("@/modules/market-data");
  return {
    ...actual,
    tradingSessionForDate: (_db: unknown, date: string) =>
      Promise.resolve({
        date,
        open: new Date("2024-01-02T13:00:00.000Z"),
        close: new Date("2024-01-02T20:00:00.000Z"),
      }),
  };
});

vi.mock("@/modules/portfolio", async () => {
  const actual = await vi.importActual<typeof import("@/modules/portfolio")>("@/modules/portfolio");
  return { ...actual, priceOperationNow: () => Promise.resolve(null) };
});

const { executePlanAction, planExecutionPrefillAction } = await import("./execute-plan-action");
const { PlanRulesRepository } = await import("./plan-rules-repository");

function uniqueEmail(label: string): string {
  return `fetha-execute-plan-${label}-${crypto.randomUUID()}@example.com`;
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
    summary: "A Fetha montou essa posição em PETR4.",
    exitRules: [
      {
        rule: { kind: "profit_target", fractionOfPremium: decimalStringSchema.parse("0.5") },
        session: null,
      },
    ],
    roll: { applies: false, session: null },
  };
}

async function insertPlan(userId: string): Promise<string> {
  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
  ];
  const [operation] = await getDb()
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
  if (!operation) throw new Error("failed to insert contemplated operation");
  await new PlanRulesRepository(getDb(), { id: userId }).save({
    contemplatedOperationId: operation.id,
    recipeId: "buy-and-hold",
    rules: fixtureRules(),
  });
  return operation.id;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  currentUser = null;
});

describe("planExecutionPrefillAction", () => {
  it("prefills one row per plan order, ticker/side/quantity from the saved plan", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("prefill");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    const result = await planExecutionPrefillAction(planId);
    expect(result).toMatchObject({
      status: "ok",
      underlying: "PETR4",
      legs: [{ ticker: "PETR4", side: "buy", quantity: 100 }],
    });
  });

  it("refuses to prefill another user's plan", async () => {
    await ensureStockStructure();
    const emailA = uniqueEmail("prefill-a");
    const emailB = uniqueEmail("prefill-b");
    createdEmails.push(emailA, emailB);
    const ownerA = await insertBareUser(emailA);
    const ownerB = await insertBareUser(emailB);
    const planId = await insertPlan(ownerA.id);

    currentUser = ownerB;
    const result = await planExecutionPrefillAction(planId);
    expect(result).toEqual({ status: "error", error: "not_found" });
  });
});

describe("executePlanAction", () => {
  it("records the fills, groups them into one operation and links the plan, in one transaction", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("ok");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    const result = await executePlanAction({
      contemplatedOperationId: planId,
      session: "2024-01-02",
      fills: [{ ticker: "PETR4", price: "30,00", costs: "" }],
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const [operationRow] = await getDb()
      .select()
      .from(operations)
      .where(eq(operations.id, result.operationId));
    expect(operationRow).toMatchObject({ underlying: "PETR4", status: "open" });

    const fillRows = await getDb()
      .select()
      .from(fills)
      .where(eq(fills.operationId, result.operationId));
    expect(fillRows).toHaveLength(1);
    expect(fillRows[0]).toMatchObject({ ticker: "PETR4", side: "buy", quantity: 100 });

    const [rulesRow] = await getDb()
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.contemplatedOperationId, planId));
    expect(rulesRow?.operationId).toBe(result.operationId);
  });

  it("refuses to execute an already-executed plan", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("double");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    const input = {
      contemplatedOperationId: planId,
      session: "2024-01-02",
      fills: [{ ticker: "PETR4", price: "30,00", costs: "" }],
    };
    const first = await executePlanAction(input);
    expect(first.status).toBe("ok");

    const second = await executePlanAction(input);
    expect(second).toEqual({ status: "error", error: "already_executed" });

    const fillRows = await getDb().select().from(fills).where(eq(fills.ticker, "PETR4"));
    expect(fillRows.filter((row) => row.userId === owner.id)).toHaveLength(1);
  });

  it("refuses to execute another user's plan", async () => {
    await ensureStockStructure();
    const emailA = uniqueEmail("cross-a");
    const emailB = uniqueEmail("cross-b");
    createdEmails.push(emailA, emailB);
    const ownerA = await insertBareUser(emailA);
    const ownerB = await insertBareUser(emailB);
    const planId = await insertPlan(ownerA.id);

    currentUser = ownerB;
    const result = await executePlanAction({
      contemplatedOperationId: planId,
      session: "2024-01-02",
      fills: [{ ticker: "PETR4", price: "30,00", costs: "" }],
    });
    expect(result).toEqual({ status: "error", error: "not_found" });

    const [rulesRow] = await getDb()
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.contemplatedOperationId, planId));
    expect(rulesRow?.operationId).toBeNull();
  });
});
