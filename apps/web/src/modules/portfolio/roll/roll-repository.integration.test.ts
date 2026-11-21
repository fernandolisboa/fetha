import { afterEach, describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type SessionDate,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import { planOperation } from "../operation-plan";
import { PortfolioRepository, type NewFill, type PlanFromFills } from "../portfolio-repository";

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<{ id: string }> {
  const email = `fetha-roll-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({ id: user.id });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function stockFill(overrides: Partial<NewFill> = {}): NewFill {
  return {
    ticker: tickerSchema.parse("PETR4"),
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: decimalStringSchema.parse("30.00"),
    session: sessionDateSchema.parse("2026-09-15"),
    costsCentavos: 0,
    expiry: null,
    source: "manual",
    importKey: null,
    ...overrides,
  };
}

const plan: PlanFromFills = (fills) => planOperation(fills, new Map());

const rolledAt: SessionDate = sessionDateSchema.parse("2026-10-16");

describe("PortfolioRepository.roll", () => {
  it("closes the source operation and opens a new one that points back at it", async () => {
    const db = getDb();
    const owner = await insertUser("roll-happy");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill()]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [stockFill({ side: "sell", price: decimalStringSchema.parse("31.00"), session: rolledAt })],
      [stockFill({ price: decimalStringSchema.parse("32.00"), session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const all = await repository.listOperations();
    const source = all.find((operation) => operation.id === grouped.operationId);
    const created = all.find((operation) => operation.id === result.newOperationId);
    expect(source).toEqual(
      expect.objectContaining({
        id: grouped.operationId,
        status: "closed",
        closedAt: rolledAt,
        rolledFromOperationId: null,
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        id: result.newOperationId,
        status: "open",
        rolledFromOperationId: grouped.operationId,
      }),
    );
  });

  it("refuses a roll computed from a fill set that has since changed", async () => {
    const db = getDb();
    const owner = await insertUser("roll-conflict");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill()]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [],
      [stockFill({ side: "sell", session: rolledAt })],
      [stockFill({ session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses a roll whose closing fills do not actually close the source operation", async () => {
    const db = getDb();
    const owner = await insertUser("roll-still-open");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill({ quantity: 200 })]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [stockFill({ side: "sell", quantity: 100, session: rolledAt })],
      [stockFill({ session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect((await repository.listOperations())[0]?.status).toBe("open");
  });
});

describe("PortfolioRepository.roll isolation", () => {
  it("user B cannot roll user A's operation", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("roll-iso-a"), insertUser("roll-iso-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    const repositoryB = new PortfolioRepository(db, b);
    await repositoryA.insertFills([stockFill()]);
    const [aFill] = await repositoryA.listFills();
    if (!aFill) throw new Error("fixture setup failed");
    const grouped = await repositoryA.group(null, [aFill.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repositoryB.roll(
      grouped.operationId,
      [aFill.id],
      [stockFill({ side: "sell", session: rolledAt })],
      [stockFill({ session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });

    expect((await repositoryA.listOperations())[0]?.status).toBe("open");
    expect(await repositoryA.listFills()).toHaveLength(1);
    expect(await repositoryB.listOperations()).toEqual([]);
  });
});
