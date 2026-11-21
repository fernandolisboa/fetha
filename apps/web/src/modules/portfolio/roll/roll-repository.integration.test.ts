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

import { holdingKey } from "../bookkeeping";
import { planOperation, type SeriesByHolding } from "../operation-plan";
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

const UNDERLYING = tickerSchema.parse("PETR4");
const CURRENT_TICKER = tickerSchema.parse("PETR4F300");
const NEXT_TICKER = tickerSchema.parse("PETR4G300");
const OPENED_AT: SessionDate = sessionDateSchema.parse("2026-09-15");
const CURRENT_EXPIRY: SessionDate = sessionDateSchema.parse("2026-10-16");
const NEXT_EXPIRY: SessionDate = sessionDateSchema.parse("2026-11-16");
const rolledAt: SessionDate = sessionDateSchema.parse("2026-10-14");

function stockFill(overrides: Partial<NewFill> = {}): NewFill {
  return {
    ticker: UNDERLYING,
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: decimalStringSchema.parse("30.00"),
    session: OPENED_AT,
    costsCentavos: 0,
    expiry: null,
    source: "manual",
    importKey: null,
    ...overrides,
  };
}

function shortCallFill(overrides: Partial<NewFill> = {}): NewFill {
  return {
    ticker: CURRENT_TICKER,
    assetClass: "option",
    side: "sell",
    quantity: 100,
    price: decimalStringSchema.parse("2.00"),
    session: OPENED_AT,
    costsCentavos: 0,
    expiry: CURRENT_EXPIRY,
    source: "manual",
    importKey: null,
    ...overrides,
  };
}

const series: SeriesByHolding = new Map([
  [
    holdingKey(CURRENT_TICKER, CURRENT_EXPIRY),
    { underlying: UNDERLYING, right: "call", strike: "30.00", expiry: CURRENT_EXPIRY },
  ],
  [
    holdingKey(NEXT_TICKER, NEXT_EXPIRY),
    { underlying: UNDERLYING, right: "call", strike: "30.00", expiry: NEXT_EXPIRY },
  ],
]);

const plan: PlanFromFills = (fills) => planOperation(fills, series);

describe("PortfolioRepository.roll", () => {
  it("closes the source operation and opens a new one that points back at it", async () => {
    const db = getDb();
    const owner = await insertUser("roll-happy");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill()]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [shortCallFill({ side: "buy", session: rolledAt })],
      [shortCallFill({ ticker: NEXT_TICKER, expiry: NEXT_EXPIRY, session: rolledAt })],
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

  it("refuses a roll computed from a fill set that has since changed, writing nothing", async () => {
    const db = getDb();
    const owner = await insertUser("roll-conflict");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill()]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [],
      [shortCallFill({ side: "buy", session: rolledAt })],
      [shortCallFill({ ticker: NEXT_TICKER, expiry: NEXT_EXPIRY, session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
    // The transaction must roll every write of this attempt back (#382): a
    // refusal after writes have already happened must never leave them committed.
    expect(await repository.listFills()).toHaveLength(1);
    expect((await repository.listOperations())[0]?.status).toBe("open");
  });

  it("refuses a roll whose closing fills do not actually close the source operation, writing nothing", async () => {
    const db = getDb();
    const owner = await insertUser("roll-still-open");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill({ quantity: 200 })]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [shortCallFill({ side: "buy", quantity: 100, session: rolledAt })],
      [shortCallFill({ ticker: NEXT_TICKER, expiry: NEXT_EXPIRY, session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "conflict" });
    // Before the fix, the closing fill's own insert committed anyway (#382):
    // the refusal must leave the fill set exactly as it was, not with a dangling closing fill.
    expect(await repository.listFills()).toHaveLength(1);
    expect((await repository.listOperations())[0]?.status).toBe("open");
  });

  it("carries a covered call's stock leg forward with its cost basis, never closing it", async () => {
    const db = getDb();
    const owner = await insertUser("roll-covered-call");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([stockFill(), shortCallFill()]);
    const inserted = await repository.listFills();
    const grouped = await repository.group(
      null,
      inserted.map((fill) => fill.id),
      plan,
    );
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      inserted.map((fill) => fill.id),
      [shortCallFill({ side: "buy", session: rolledAt })],
      [shortCallFill({ ticker: NEXT_TICKER, expiry: NEXT_EXPIRY, session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const all = await repository.listOperations();
    const source = all.find((operation) => operation.id === grouped.operationId);
    const created = all.find((operation) => operation.id === result.newOperationId);
    expect(source?.status).toBe("closed");
    expect(created?.status).toBe("open");

    const fills = await repository.listFills();
    const sourceFills = fills.filter((fill) => fill.operationId === grouped.operationId);
    const newFills = fills.filter((fill) => fill.operationId === result.newOperationId);
    // The stock leg's own original fill moved to the new operation, cost basis intact (its
    // price is untouched), rather than being closed (#382).
    expect(newFills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetClass: "stock", side: "buy", price: "30.000000" }),
        expect.objectContaining({ ticker: NEXT_TICKER, assetClass: "option", side: "sell" }),
      ]),
    );
    expect(newFills).toHaveLength(2);
    expect(sourceFills.every((fill) => fill.assetClass === "option")).toBe(true);
  });
});

describe("PortfolioRepository.roll isolation", () => {
  it("user B cannot roll user A's operation", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("roll-iso-a"), insertUser("roll-iso-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    const repositoryB = new PortfolioRepository(db, b);
    await repositoryA.insertFills([shortCallFill()]);
    const [aFill] = await repositoryA.listFills();
    if (!aFill) throw new Error("fixture setup failed");
    const grouped = await repositoryA.group(null, [aFill.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repositoryB.roll(
      grouped.operationId,
      [aFill.id],
      [shortCallFill({ side: "buy", session: rolledAt })],
      [shortCallFill({ ticker: NEXT_TICKER, expiry: NEXT_EXPIRY, session: rolledAt })],
      rolledAt,
      plan,
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });

    expect((await repositoryA.listOperations())[0]?.status).toBe("open");
    expect(await repositoryA.listFills()).toHaveLength(1);
    expect(await repositoryB.listOperations()).toEqual([]);
  });
});
