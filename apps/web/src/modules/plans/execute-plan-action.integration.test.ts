import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import { decimalStringSchema, type ContemplatedLeg, type PlanRules } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { parsePriceInput } from "@/modules/portfolio/parse-price";
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

const { priceOperationNowMock } = vi.hoisted(() => ({
  priceOperationNowMock: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/modules/portfolio", async () => {
  const actual = await vi.importActual<typeof import("@/modules/portfolio")>("@/modules/portfolio");
  return { ...actual, priceOperationNow: priceOperationNowMock };
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

  it("refuses to prefill a plan that was already executed", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("prefill-already-executed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    const first = await executePlanAction({
      contemplatedOperationId: planId,
      session: "2024-01-02",
      fills: [{ ticker: "PETR4", quantity: 100, price: "30,00", costs: "" }],
    });
    expect(first.status).toBe("ok");

    const result = await planExecutionPrefillAction(planId);
    expect(result).toEqual({ status: "error", error: "already_executed" });
  });

  // Prefill is pt-BR formatted precisely so it can be submitted unedited (review round 2, #381):
  // `parsePriceInput` only ever accepts pt-BR input, so a dot-decimal prefill could never
  // round-trip through the dialog's own submit path.
  it("prefills a pt-BR price that round-trips through parsePriceInput and submits unedited", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("prefill-roundtrip");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    priceOperationNowMock.mockResolvedValueOnce({
      legs: [{ leg: { ticker: "PETR4" }, price: decimalStringSchema.parse("1234.500000") }],
    } as never);

    const prefill = await planExecutionPrefillAction(planId);
    if (prefill.status !== "ok") throw new Error("prefill failed");
    const [leg] = prefill.legs;
    if (!leg?.price) throw new Error("expected a prefilled price");
    // pt-BR grouping puts a "." between thousands (1.234,50), so only the decimal comma is a
    // reliable formatting signal here (round 2 correctness finding, #381).
    expect(leg.price).toContain(",");
    expect(parsePriceInput(leg.price)).not.toBeNull();

    const result = await executePlanAction({
      contemplatedOperationId: planId,
      session: prefill.today,
      fills: [{ ticker: "PETR4", quantity: leg.quantity, price: leg.price, costs: "" }],
    });
    expect(result.status).toBe("ok");
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
      fills: [{ ticker: "PETR4", quantity: 100, price: "30,00", costs: "" }],
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

  // The transaction is atomic end to end (review round 2, #381): a refusal partway through
  // (`planOperation`'s own `mixed_underlyings`, forced by a plan with two stock legs on
  // different tickers) rolls back the fills `recordFillsAsOperation` had already inserted, not
  // only the grouping step — a mixed-expiry plan would otherwise leave orphan fills on every
  // retry.
  it("leaves zero fills and operations when the transaction is refused mid-way", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("forced-refusal");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;

    const legs: ContemplatedLeg[] = [
      { role: "stock", side: "buy", ticker: "PETR4", quantity: 100 } as ContemplatedLeg,
      { role: "stock", side: "buy", ticker: "VALE3", quantity: 50 } as ContemplatedLeg,
    ];
    const [contemplated] = await getDb()
      .insert(contemplatedOperations)
      .values({
        userId: owner.id,
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
    await new PlanRulesRepository(getDb(), owner).save({
      contemplatedOperationId: contemplated.id,
      recipeId: "buy-and-hold",
      rules: fixtureRules(),
    });

    const result = await executePlanAction({
      contemplatedOperationId: contemplated.id,
      session: "2024-01-02",
      fills: [
        { ticker: "PETR4", quantity: 100, price: "30,00", costs: "" },
        { ticker: "VALE3", quantity: 50, price: "60,00", costs: "" },
      ],
    });
    expect(result).toEqual({ status: "error", error: "mixed_underlyings" });

    const fillRows = await getDb().select().from(fills).where(eq(fills.userId, owner.id));
    expect(fillRows).toHaveLength(0);
    const operationRows = await getDb()
      .select()
      .from(operations)
      .where(eq(operations.userId, owner.id));
    expect(operationRows).toHaveLength(0);
    const [rulesRow] = await getDb()
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.contemplatedOperationId, contemplated.id));
    expect(rulesRow?.operationId).toBeNull();
  });

  // The same atomicity, exercised as the real race it guards against (review round 2, #381): two
  // concurrent submits of the same plan. Both insert their own fills and group their own
  // operation before either reaches `linkOperation`; the loser's link is refused inside its own
  // transaction, which must rollback its own fills and operation, not just fail to link — a
  // `return` there would have left a second, orphaned operation behind.
  it("a concurrent double submit leaves exactly one operation, not two", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("concurrent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const planId = await insertPlan(owner.id);

    const input = {
      contemplatedOperationId: planId,
      session: "2024-01-02",
      fills: [{ ticker: "PETR4", quantity: 100, price: "30,00", costs: "" }],
    };
    const [first, second] = await Promise.all([executePlanAction(input), executePlanAction(input)]);
    const results = [first, second];
    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
    expect(results.filter((result) => result.status === "error")).toHaveLength(1);

    const operationRows = await getDb()
      .select()
      .from(operations)
      .where(eq(operations.userId, owner.id));
    expect(operationRows).toHaveLength(1);
    const fillRows = await getDb().select().from(fills).where(eq(fills.userId, owner.id));
    expect(fillRows).toHaveLength(1);
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
      fills: [{ ticker: "PETR4", quantity: 100, price: "30,00", costs: "" }],
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
      fills: [{ ticker: "PETR4", quantity: 100, price: "30,00", costs: "" }],
    });
    expect(result).toEqual({ status: "error", error: "not_found" });

    const [rulesRow] = await getDb()
      .select()
      .from(operationPlanRules)
      .where(eq(operationPlanRules.contemplatedOperationId, planId));
    expect(rulesRow?.operationId).toBeNull();
  });
});
