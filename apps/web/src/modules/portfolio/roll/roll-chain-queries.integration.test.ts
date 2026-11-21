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

import { rollChainFor } from "./roll-chain-queries";

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<{ id: string }> {
  const email = `fetha-roll-chain-${label}-${crypto.randomUUID()}@example.com`;
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
const ROLLED_AT: SessionDate = sessionDateSchema.parse("2026-10-14");

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

describe("rollChainFor", () => {
  it("nets a roll's own closing-plus-opening cash, and carries the still-open last link's own opening premium into the running total", async () => {
    const db = getDb();
    const owner = await insertUser("chain-happy");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill({ price: decimalStringSchema.parse("2.00") })]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [
        shortCallFill({
          side: "buy",
          price: decimalStringSchema.parse("1.20"),
          session: ROLLED_AT,
        }),
      ],
      [
        shortCallFill({
          ticker: NEXT_TICKER,
          expiry: NEXT_EXPIRY,
          price: decimalStringSchema.parse("4.50"),
          session: ROLLED_AT,
        }),
      ],
      ROLLED_AT,
      plan,
    );
    if (!result.ok) throw new Error(result.reason);

    const rows = await rollChainFor(db, owner, result.newOperationId);
    // The closed root link nets its own opened premium (+200.00) against its own closing cost
    // (-120.00): +80.00. The still-open new link carries only its own opening premium (+450.00),
    // since nothing has closed it yet. Both land in the roll's own month (#382 review advisory).
    expect(rows).toEqual([
      {
        month: "2026-10",
        operationIds: [grouped.operationId, result.newOperationId],
        netCentavos: 8000 + 45000,
        runningTotalCentavos: 8000 + 45000,
      },
    ]);
  });

  it("is readable from any link in the chain, not only the newest", async () => {
    const db = getDb();
    const owner = await insertUser("chain-any-link");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill()]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repository.roll(
      grouped.operationId,
      [opened.id],
      [shortCallFill({ side: "buy", session: ROLLED_AT })],
      [
        shortCallFill({
          ticker: NEXT_TICKER,
          expiry: NEXT_EXPIRY,
          session: ROLLED_AT,
        }),
      ],
      ROLLED_AT,
      plan,
    );
    if (!result.ok) throw new Error(result.reason);

    const fromRoot = await rollChainFor(db, owner, grouped.operationId);
    const fromHead = await rollChainFor(db, owner, result.newOperationId);
    expect(fromRoot).toEqual(fromHead);
  });
});

describe("rollChainFor isolation", () => {
  it("user B sees nothing of user A's roll chain", async () => {
    const db = getDb();
    const [a, b] = await Promise.all([insertUser("chain-iso-a"), insertUser("chain-iso-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    await repositoryA.insertFills([shortCallFill()]);
    const [aFill] = await repositoryA.listFills();
    if (!aFill) throw new Error("fixture setup failed");
    const grouped = await repositoryA.group(null, [aFill.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const result = await repositoryA.roll(
      grouped.operationId,
      [aFill.id],
      [shortCallFill({ side: "buy", session: ROLLED_AT })],
      [
        shortCallFill({
          ticker: NEXT_TICKER,
          expiry: NEXT_EXPIRY,
          session: ROLLED_AT,
        }),
      ],
      ROLLED_AT,
      plan,
    );
    if (!result.ok) throw new Error(result.reason);

    const rowsForB = await rollChainFor(db, b, result.newOperationId);
    expect(rowsForB).toEqual([]);
    const rowsForA = await rollChainFor(db, a, result.newOperationId);
    expect(rowsForA.length).toBeGreaterThan(0);
  });
});
