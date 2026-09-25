import { afterEach, describe, expect, it } from "vitest";
import {
  centavosSchema,
  confidenceSchema,
  quantitySchema,
  tickerSchema,
  type Centavos,
  type DecimalString,
  type ThesisClaim,
  type Ticker,
} from "@fetha/contracts";
import type { Score } from "@fetha/engine";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { OperationsRepository } from "@/modules/portfolio/operations-repository";
import { structures } from "@/modules/strategies/schema";

import { DecisionScoresRepository, type NewDecisionScore } from "./decision-scores-repository";
import { DecisionsRepository } from "./decisions-repository";
import type { DecisionInputs } from "./inputs";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return centavosSchema.parse(value);
}

function uniqueEmail(label: string): string {
  return `fetha-decision-scores-repo-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`DS${suffix}`);
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

function operationInputs(underlying: Ticker): DecisionInputs {
  return {
    originKind: "contemplated_operation",
    underlying,
    structureId: "stock",
    structureName: "Compra de ação",
    legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) }],
    session: "2031-06-01",
    netPremiumCentavos: centavos(300000),
    maxLossCentavos: centavos(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  };
}

async function createDecision(
  owner: { id: string; name: string; email: string },
  underlying: Ticker,
  horizon: string,
  claim: ThesisClaim | null = null,
): Promise<{ id: string }> {
  const db = getDb();
  const operationRepository = new OperationsRepository(db, owner);
  const saved = await operationRepository.save({
    structureId: "stock",
    underlying,
    legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) }],
    session: "2031-06-01",
    netPremiumCentavos: centavos(300000),
    maxLossCentavos: centavos(300000),
    maxGainCentavos: null,
    breachedLimits: [],
  });

  const repository = new DecisionsRepository(db, owner);
  return repository.record({
    kind: "enter",
    originKind: "contemplated_operation",
    signalId: null,
    contemplatedOperationId: saved.id,
    strategyVersionId: null,
    inputs: operationInputs(underlying),
    rationale: "Test decision for scoring",
    claim,
    confidence: confidenceSchema.parse("0.6"),
    horizon,
    costModel: DEFAULT_COST_MODEL,
  });
}

function scoreFixture(overrides: Partial<Score> = {}): Score {
  return {
    pnl: null,
    maxLoss: null,
    normalizedPnl: null,
    thesis: { claim: null },
    counterfactualPnl: null,
    notes: [],
    provenance: { engineVersion: "test-1", computedAt: "2031-06-15T21:00:00.000Z" },
    ...overrides,
  } as Score;
}

function newScore(decisionId: string, overrides: Partial<NewDecisionScore> = {}): NewDecisionScore {
  return {
    decisionId,
    score: scoreFixture(),
    pnlCentavos: null,
    maxLossCentavos: null,
    maxLossUnbounded: false,
    normalizedPnl: null,
    claimHeld: null,
    brier: null,
    counterfactualPnlCentavos: null,
    engineVersion: "test-1",
    ...overrides,
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("DecisionScoresRepository", () => {
  it("inserts a score for a decision and lists it back with its extracted columns", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("insert-list");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const decision = await createDecision(owner, randomTicker(), "2031-06-15");

    const repository = new DecisionScoresRepository(db, owner);
    const result = await repository.insertIfAbsent(
      newScore(decision.id, {
        pnlCentavos: centavos(15000),
        maxLossCentavos: centavos(30000),
        normalizedPnl: decimalString("0.5"),
      }),
    );

    expect(result.inserted).toBe(true);
    const mine = await repository.listMine();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.decisionId).toBe(decision.id);
    expect(mine[0]?.pnlCentavos).toBe(15000);
    expect(mine[0]?.normalizedPnl).toBe("0.5");
  });

  it("is idempotent: a second insert for the same decision changes nothing (append-only)", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("idempotent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const decision = await createDecision(owner, randomTicker(), "2031-06-15");

    const repository = new DecisionScoresRepository(db, owner);
    const first = await repository.insertIfAbsent(newScore(decision.id));
    const second = await repository.insertIfAbsent(
      newScore(decision.id, { pnlCentavos: centavos(999999) }),
    );

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    const mine = await repository.listMine();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.pnlCentavos).toBeNull();
  });

  it("rejects an UPDATE at the database level (append-only trigger)", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("no-update");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const decision = await createDecision(owner, randomTicker(), "2031-06-15");

    const repository = new DecisionScoresRepository(db, owner);
    await repository.insertIfAbsent(newScore(decision.id));

    const { decisionScores } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    let caught: unknown;
    try {
      await db
        .update(decisionScores)
        .set({ engineVersion: "tampered" })
        .where(eq(decisionScores.decisionId, decision.id));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = caught instanceof Error ? caught.cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    expect(causeMessage).toMatch(/immutable/);
  });

  it("dueForUser returns only decisions whose horizon has arrived and are not yet scored", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("due");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const due = await createDecision(owner, randomTicker(), "2031-06-15");
    const notDue = await createDecision(owner, randomTicker(), "2031-06-20");

    const repository = new DecisionScoresRepository(db, owner);
    const dueRows = await repository.dueForUser("2031-06-15");
    expect(dueRows.map((row) => row.id)).toEqual([due.id]);
    expect(dueRows.map((row) => row.id)).not.toContain(notDue.id);

    await repository.insertIfAbsent(newScore(due.id));
    const dueAfterScoring = await repository.dueForUser("2031-06-15");
    expect(dueAfterScoring).toEqual([]);
  });

  it("computes track record stats server-side from claim and Brier columns", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("track-record");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const held = await createDecision(owner, randomTicker(), "2031-06-15", {
      kind: "close_above",
      instrument: randomTicker(),
      level: decimalString("40"),
    });
    const notHeld = await createDecision(owner, randomTicker(), "2031-06-15", {
      kind: "close_above",
      instrument: randomTicker(),
      level: decimalString("40"),
    });

    const repository = new DecisionScoresRepository(db, owner);
    await repository.insertIfAbsent(
      newScore(held.id, {
        claimHeld: true,
        brier: decimalString("0.1"),
        normalizedPnl: decimalString("0.3"),
      }),
    );
    await repository.insertIfAbsent(
      newScore(notHeld.id, {
        claimHeld: false,
        brier: decimalString("0.9"),
        normalizedPnl: decimalString("-0.2"),
      }),
    );

    const stats = await repository.trackRecordStats();
    expect(stats.scoredCount).toBe(2);
    expect(stats.claimsScoredCount).toBe(2);
    expect(stats.claimsHeldCount).toBe(1);
    expect(stats.meanBrier).toBe("0.5000");
    expect(stats.pnlOverTime).toHaveLength(2);
    expect(stats.confidenceBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });

  it("isolation: user A cannot read user B's scores via listMine, findForDecisions or dueForUser", async () => {
    const db = getDb();
    await ensureStockStructure();
    const emailA = uniqueEmail("isolation-a");
    const emailB = uniqueEmail("isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const decisionB = await createDecision(userB, randomTicker(), "2031-06-15");
    const repoB = new DecisionScoresRepository(db, userB);
    await repoB.insertIfAbsent(newScore(decisionB.id, { pnlCentavos: centavos(1000) }));

    const repoA = new DecisionScoresRepository(db, userA);
    expect(await repoA.listMine()).toEqual([]);
    expect(await repoA.findForDecisions([decisionB.id])).toEqual(new Map());
    expect(await repoA.dueForUser("2031-06-15")).toEqual([]);
    const statsA = await repoA.trackRecordStats();
    expect(statsA.scoredCount).toBe(0);

    expect(await repoB.listMine()).toHaveLength(1);
  });
});
