import { afterEach, describe, expect, it } from "vitest";
import {
  centavosSchema,
  confidenceSchema,
  quantitySchema,
  tickerSchema,
  type DecimalString,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { OperationsRepository } from "@/modules/portfolio/operations-repository";
import { SignalsRepository } from "@/modules/strategies/signals-repository";
import { StrategiesRepository } from "@/modules/strategies/strategies-repository";
import { structures } from "@/modules/strategies/schema";

import { DecisionsRepository, DuplicateSignalDecisionError } from "./decisions-repository";
import type { DecisionInputs } from "./inputs";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-decisions-repo-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`DR${suffix}`);
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

function definition(): StrategyDefinition {
  return {
    name: "DR test",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("0") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function createSignal(
  db: ReturnType<typeof getDb>,
  owner: { id: string; name: string; email: string },
  ticker: Ticker,
) {
  const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
  const version = strategy.versions[0];
  if (!version) throw new Error("test setup: expected a version");

  const signalsRepository = new SignalsRepository(db, owner);
  await signalsRepository.createSignals([
    {
      strategyId: strategy.id,
      strategyVersionId: version.id,
      ticker,
      timeframe: "D1",
      session: "2031-06-01",
      at: new Date("2031-06-01T21:00:00.000Z"),
      kind: "entry",
      indicators: [],
      proposal: null,
      operationId: null,
      rule: null,
    },
  ]);
  const [signal] = await signalsRepository.listInbox();
  if (!signal) throw new Error("test setup: expected a signal");
  return { signal, strategyVersionId: version.id };
}

async function createOperation(
  db: ReturnType<typeof getDb>,
  owner: { id: string; name: string; email: string },
  underlying: Ticker,
) {
  const repository = new OperationsRepository(db, owner);
  const saved = await repository.save({
    structureId: "stock",
    underlying,
    legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) }],
    session: "2031-06-01",
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  });
  return saved.id;
}

function signalInputs(ticker: Ticker): DecisionInputs {
  return {
    originKind: "signal",
    ticker,
    session: "2031-06-01",
    kind: "entry",
    indicators: [],
    proposal: null,
    rule: null,
  };
}

function operationInputs(underlying: Ticker): DecisionInputs {
  return {
    originKind: "contemplated_operation",
    underlying,
    structureId: "stock",
    legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) }],
    session: "2031-06-01",
    netPremiumCentavos: centavosSchema.parse(300000),
    maxLossCentavos: centavosSchema.parse(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  };
}

describe("DecisionsRepository", () => {
  it("records and lists a signal-origin decision, round-tripping every field", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("signal-roundtrip");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();
    const { signal, strategyVersionId } = await createSignal(db, owner, ticker);

    const repository = new DecisionsRepository(db, owner);
    const recorded = await repository.record({
      kind: "enter",
      originKind: "signal",
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId,
      inputs: signalInputs(ticker),
      rationale: "Trend looks strong",
      claim: { kind: "close_above", instrument: ticker, level: decimalString("40") },
      confidence: confidenceSchema.parse("0.6"),
      horizon: "2031-06-15",
      costModel: DEFAULT_COST_MODEL,
    });

    const mine = await repository.listMine();
    expect(mine).toHaveLength(1);
    const [entry] = mine;
    expect(entry?.id).toBe(recorded.id);
    expect(entry?.kind).toBe("enter");
    expect(entry?.originKind).toBe("signal");
    expect(entry?.rationale).toBe("Trend looks strong");
    expect(entry?.confidence).toBe("0.6");
    expect(entry?.horizon).toBe("2031-06-15");
    expect(entry?.ticker).toBe(ticker);
    expect(entry?.strategyName).toBe("DR test");
    expect(entry?.claim).toEqual({ kind: "close_above", instrument: ticker, level: "40" });

    const found = await repository.findForSignal(signal.id);
    expect(found?.id).toBe(recorded.id);
  });

  it("records and lists a contemplated-operation-origin decision", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("operation-roundtrip");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const underlying = randomTicker();
    const operationId = await createOperation(db, owner, underlying);

    const repository = new DecisionsRepository(db, owner);
    await repository.record({
      kind: "do_not_enter",
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: operationId,
      strategyVersionId: null,
      inputs: operationInputs(underlying),
      rationale: "Premium too thin",
      claim: null,
      confidence: confidenceSchema.parse("0.4"),
      horizon: "2031-06-20",
      costModel: DEFAULT_COST_MODEL,
    });

    const mine = await repository.listMine();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.originKind).toBe("contemplated_operation");
    expect(mine[0]?.underlying).toBe(underlying);
    expect(mine[0]?.structureName).toBe("Compra de ação");
    expect(mine[0]?.claim).toBeNull();

    const foundForOperation = await repository.findLatestForOperation(operationId);
    expect(foundForOperation?.underlying).toBe(underlying);
  });

  it("rejects a second decision recorded against the same signal (a signal is answered once)", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("duplicate-signal");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();
    const { signal, strategyVersionId } = await createSignal(db, owner, ticker);

    const repository = new DecisionsRepository(db, owner);
    const input = {
      kind: "enter" as const,
      originKind: "signal" as const,
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId,
      inputs: signalInputs(ticker),
      rationale: "First answer",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
      costModel: DEFAULT_COST_MODEL,
    };
    await repository.record(input);

    await expect(repository.record({ ...input, rationale: "Second answer" })).rejects.toThrow(
      DuplicateSignalDecisionError,
    );

    expect(await repository.listMine()).toHaveLength(1);
  });

  it("rejects an UPDATE on a decision row: decisions are append-only", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("append-only");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();
    const { signal, strategyVersionId } = await createSignal(db, owner, ticker);

    const repository = new DecisionsRepository(db, owner);
    const recorded = await repository.record({
      kind: "enter",
      originKind: "signal",
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId,
      inputs: signalInputs(ticker),
      rationale: "Original rationale",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
      costModel: DEFAULT_COST_MODEL,
    });

    const { decisions } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    let caught: unknown;
    try {
      await db.update(decisions).set({ rationale: "Edited" }).where(eq(decisions.id, recorded.id));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = caught instanceof Error ? caught.cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    expect(causeMessage).toMatch(/immutable/);
  });

  it("isolation: user A cannot list user B's decisions", async () => {
    const db = getDb();
    await ensureStockStructure();
    const emailA = uniqueEmail("isolation-a");
    const emailB = uniqueEmail("isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const tickerB = randomTicker();
    const { signal: signalB, strategyVersionId } = await createSignal(db, userB, tickerB);

    const repoB = new DecisionsRepository(db, userB);
    await repoB.record({
      kind: "enter",
      originKind: "signal",
      signalId: signalB.id,
      contemplatedOperationId: null,
      strategyVersionId,
      inputs: signalInputs(tickerB),
      rationale: "B's own decision",
      claim: null,
      confidence: confidenceSchema.parse("0.7"),
      horizon: "2031-06-15",
      costModel: DEFAULT_COST_MODEL,
    });

    const repoA = new DecisionsRepository(db, userA);
    expect(await repoA.listMine()).toEqual([]);
    expect(await repoA.findForSignal(signalB.id)).toBeNull();
    expect(await repoB.listMine()).toHaveLength(1);
  });
});
