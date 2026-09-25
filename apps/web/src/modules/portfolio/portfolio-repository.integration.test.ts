import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type SessionDate,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import {
  PortfolioRepository,
  type FillRecord,
  type NewFill,
  type OperationWrite,
  type PlanFromFills,
} from "./portfolio-repository";
import { fills } from "./schema";

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<{ id: string }> {
  const email = `fetha-portfolio-${label}-${crypto.randomUUID()}@example.com`;
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
    price: decimalStringSchema.parse("30.5"),
    session: sessionDateSchema.parse("2026-09-15"),
    costsCentavos: 0,
    expiry: null,
    source: "manual",
    importKey: null,
    ...overrides,
  };
}

function openState(planned: FillRecord[]): OperationWrite {
  return {
    underlying: tickerSchema.parse("PETR4"),
    expiry: null,
    openedAt: planned[0]?.session ?? sessionDateSchema.parse("2026-09-15"),
    status: "open",
    closedAt: null,
  };
}

const openPlan: PlanFromFills = (planned) => ({ ok: true, state: openState(planned) });

const closedAt: SessionDate = sessionDateSchema.parse("2026-09-16");

describe("PortfolioRepository", () => {
  it("skips an import key the user already has and keeps keys per user", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("a"), insertUser("b")]);
    const imported = [
      stockFill({ source: "b3_import", importKey: "key-1" }),
      stockFill({ source: "b3_import", importKey: "key-2" }),
    ];

    expect(await new PortfolioRepository(db, a).insertFills(imported)).toEqual({ inserted: 2 });
    expect(await new PortfolioRepository(db, a).insertFills(imported)).toEqual({ inserted: 0 });
    expect(await new PortfolioRepository(db, b).insertFills(imported)).toEqual({ inserted: 2 });
    expect(await new PortfolioRepository(db, a).listFills()).toHaveLength(2);
  });

  it("groups unassigned fills, re-plans on add, and ungroups only an open operation", async () => {
    const db = getDb();
    const owner = await insertUser("group");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill(), stockFill({ side: "sell", session: closedAt })]);
    const [buy, sell] = await repository.listFills();
    if (!buy || !sell) throw new Error("fixture setup failed");

    const grouped = await repository.group(null, [buy.id], openPlan);
    if (!grouped.ok) throw new Error(grouped.reason);
    expect(await repository.countOpenOperations()).toBe(1);

    const regrouped = await repository.group(grouped.operationId, [sell.id], (planned) => {
      expect(planned.map((fill) => fill.id).sort()).toEqual([buy.id, sell.id].sort());
      return { ok: true, state: { ...openState(planned), status: "closed", closedAt } };
    });
    expect(regrouped).toEqual({ ok: true, operationId: grouped.operationId });
    expect(await repository.countOpenOperations()).toBe(0);
    expect(await repository.ungroup(grouped.operationId)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses to group a fill that already belongs to an operation", async () => {
    const db = getDb();
    const owner = await insertUser("twice");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill()]);
    const [only] = await repository.listFills();
    if (!only) throw new Error("fixture setup failed");
    const first = await repository.group(null, [only.id], openPlan);
    expect(first.ok).toBe(true);
    expect(await repository.group(null, [only.id], openPlan)).toEqual({
      ok: false,
      reason: "fills_unavailable",
    });
  });

  it("puts fills back when an open operation is ungrouped", async () => {
    const db = getDb();
    const owner = await insertUser("ungroup");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill()]);
    const [only] = await repository.listFills();
    if (!only) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [only.id], openPlan);
    if (!grouped.ok) throw new Error(grouped.reason);

    expect(await repository.ungroup(grouped.operationId)).toEqual({ ok: true });
    expect((await repository.listFills())[0]?.operationId).toBeNull();
    expect(await repository.listOperations()).toEqual([]);
  });

  it("refuses a settlement computed from a fill set that has since changed", async () => {
    const db = getDb();
    const owner = await insertUser("conflict");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill()]);
    const [only] = await repository.listFills();
    if (!only) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [only.id], openPlan);
    if (!grouped.ok) throw new Error(grouped.reason);

    expect(await repository.settle(grouped.operationId, [], [], closedAt)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await repository.settle(grouped.operationId, [only.id], [], closedAt)).toEqual({
      ok: true,
    });
    expect((await repository.listOperations())[0]?.status).toBe("expired");
  });
});

describe("PortfolioRepository isolation", () => {
  it("user B cannot read, change, group, ungroup or settle user A's fills and operations", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("iso-a"), insertUser("iso-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    const repositoryB = new PortfolioRepository(db, b);
    await repositoryA.insertFills([stockFill(), stockFill({ session: closedAt })]);
    await repositoryB.insertFills([stockFill()]);
    const [aGrouped, aLoose] = await repositoryA.listFills();
    const [bOwn] = await repositoryB.listFills();
    if (!aGrouped || !aLoose || !bOwn) throw new Error("fixture setup failed");
    const grouped = await repositoryA.group(null, [aGrouped.id], openPlan);
    if (!grouped.ok) throw new Error(grouped.reason);

    expect((await repositoryB.listFills()).map((fill) => fill.id)).toEqual([bOwn.id]);
    expect(await repositoryB.listOperations()).toEqual([]);
    expect(await repositoryB.countOpenOperations()).toBe(0);

    expect(await repositoryB.deleteUnassignedFill(aLoose.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await repositoryB.group(null, [aLoose.id], openPlan)).toEqual({
      ok: false,
      reason: "fills_unavailable",
    });
    expect(await repositoryB.group(grouped.operationId, [bOwn.id], openPlan)).toEqual({
      ok: false,
      reason: "operation_unavailable",
    });
    expect(await repositoryB.ungroup(grouped.operationId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await repositoryB.settle(grouped.operationId, [aGrouped.id], [], closedAt)).toEqual({
      ok: false,
      reason: "not_found",
    });

    expect(await repositoryA.listFills()).toHaveLength(2);
    expect((await repositoryA.listOperations())[0]?.status).toBe("open");
  });

  it("the database refuses a fill pointing at another user's operation", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("fk-a"), insertUser("fk-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    await repositoryA.insertFills([stockFill()]);
    const [aFill] = await repositoryA.listFills();
    if (!aFill) throw new Error("fixture setup failed");
    const grouped = await repositoryA.group(null, [aFill.id], openPlan);
    if (!grouped.ok) throw new Error(grouped.reason);

    await expect(
      db.insert(fills).values({ ...stockFill(), userId: b.id, operationId: grouped.operationId }),
    ).rejects.toThrow();
    expect(await db.select().from(fills).where(eq(fills.userId, b.id))).toEqual([]);
  });
});
