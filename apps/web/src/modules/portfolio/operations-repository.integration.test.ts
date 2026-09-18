import { afterEach, describe, expect, it } from "vitest";
import { centavosSchema, quantitySchema, type ContemplatedLeg } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { structures } from "@/modules/strategies/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { OperationsRepository, type SaveContemplatedOperationInput } from "./operations-repository";

function uniqueEmail(label: string): string {
  return `fetha-operations-${label}-${crypto.randomUUID()}@example.com`;
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

function stockOperation(underlying: string): SaveContemplatedOperationInput {
  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) },
  ];
  return {
    structureId: "stock",
    underlying,
    legs,
    session: "2026-09-10",
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("OperationsRepository isolation", () => {
  it("user A cannot read or write user B's contemplated operations", async () => {
    const db = getDb();
    await ensureStockStructure();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);

    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await new OperationsRepository(db, userA).save(stockOperation("PETR4"));
    await new OperationsRepository(db, userB).save(stockOperation("VALE3"));

    const mineA = await new OperationsRepository(db, userA).listMine();
    const mineB = await new OperationsRepository(db, userB).listMine();

    expect(mineA).toHaveLength(1);
    expect(mineA[0]?.underlying).toBe("PETR4");
    expect(mineB).toHaveLength(1);
    expect(mineB[0]?.underlying).toBe("VALE3");
  });

  it("returns an empty list before any operation is saved", async () => {
    const db = getDb();
    const email = uniqueEmail("none");
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    const mine = await new OperationsRepository(db, testUser).listMine();

    expect(mine).toEqual([]);
  });
});
