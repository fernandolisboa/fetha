import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import {
  centavosSchema,
  confidenceSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedOperation, seedOptionSeries, seedStockOperation } from "@/db/test/held-operation";
import { PortfolioRepository } from "@/modules/portfolio/portfolio-repository";
import { tradingSessions } from "@/modules/market-data/schema";
import { OperationsRepository } from "@/modules/portfolio/operations-repository";
import { SignalsRepository } from "@/modules/strategies/signals-repository";
import { StrategiesRepository } from "@/modules/strategies/strategies-repository";
import { structures } from "@/modules/strategies/schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { recordDecisionAction } = await import("./actions");
const { DecisionsRepository } = await import("./decisions-repository");
const { todaySaoPauloDate } = await import("@/lib/today-sao-paulo");

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-decisions-actions-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`DA${suffix}`);
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
    name: "DA test",
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

async function createSignal(owner: CurrentUser, ticker: Ticker) {
  const db = getDb();
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
  return signal;
}

async function createOperation(owner: CurrentUser, underlying: Ticker): Promise<string> {
  const repository = new OperationsRepository(getDb(), owner);
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

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("recordDecisionAction isolation", () => {
  it("user A cannot record a decision against user B's signal", async () => {
    await ensureStockStructure();
    const emailA = uniqueEmail("signal-isolation-a");
    const emailB = uniqueEmail("signal-isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const tickerB = randomTicker();
    currentUser = userB;
    const signalB = await createSignal(userB, tickerB);

    currentUser = userA;
    const result = await recordDecisionAction({
      originKind: "signal",
      targetId: signalB.id,
      kind: "enter",
      rationale: "Trying to answer B's signal",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_found" });

    const repoB = new DecisionsRepository(getDb(), userB);
    expect(await repoB.listMine()).toEqual([]);
  });

  it("user A cannot record a decision against user B's contemplated operation", async () => {
    await ensureStockStructure();
    const emailA = uniqueEmail("operation-isolation-a");
    const emailB = uniqueEmail("operation-isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const underlyingB = randomTicker();
    const operationIdB = await createOperation(userB, underlyingB);

    currentUser = userA;
    const result = await recordDecisionAction({
      originKind: "contemplated_operation",
      targetId: operationIdB,
      kind: "enter",
      rationale: "Trying to answer B's operation",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_found" });

    const repoB = new DecisionsRepository(getDb(), userB);
    expect(await repoB.listMine()).toEqual([]);
  });
});

describe("recordDecisionAction", () => {
  it("records a decision against the caller's own entry signal and marks it read", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("record-marks-read");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);
    expect(signal.readAt).toBeNull();

    const result = await recordDecisionAction({
      originKind: "signal",
      targetId: signal.id,
      kind: "enter",
      rationale: "Entering on strength",
      claim: null,
      confidence: confidenceSchema.parse("0.65"),
      horizon: "2031-06-15",
    });

    expect(result.status).toBe("ok");

    const signalsRepository = new SignalsRepository(getDb(), owner);
    const [updated] = await signalsRepository.listInbox();
    expect(updated?.readAt).not.toBeNull();

    const repository = new DecisionsRepository(getDb(), owner);
    expect(await repository.listMine()).toHaveLength(1);
  });

  it("rejects a kind not allowed for the origin (exit/hold only for an exit signal)", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("kind-not-allowed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);

    const result = await recordDecisionAction({
      originKind: "signal",
      targetId: signal.id,
      kind: "exit",
      rationale: "Wrong kind for an entry signal",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_allowed" });
  });

  it("rejects a second decision recorded against the same signal", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("duplicate-via-action");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);

    const first = await recordDecisionAction({
      originKind: "signal",
      targetId: signal.id,
      kind: "do_not_enter",
      rationale: "First answer",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });
    expect(first.status).toBe("ok");

    const second = await recordDecisionAction({
      originKind: "signal",
      targetId: signal.id,
      kind: "enter",
      rationale: "Changed my mind",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(second).toEqual({ status: "error", error: "duplicate" });
  });

  it("rejects a horizon before today in America/Sao_Paulo with a typed result instead of throwing", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("horizon-in-past");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);

    const today = new Date(`${todaySaoPauloDate()}T00:00:00.000Z`);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayIso = yesterday.toISOString().slice(0, 10);

    await expect(
      recordDecisionAction({
        originKind: "signal",
        targetId: signal.id,
        kind: "enter",
        rationale: "Horizon already in the past",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: sessionDateSchema.parse(yesterdayIso),
      }),
    ).resolves.toEqual({ status: "error", error: "horizon_in_past" });

    const repository = new DecisionsRepository(getDb(), owner);
    expect(await repository.listMine()).toEqual([]);
  });

  it("rejects a horizon of today once today's own session has already closed (#29 fix-web item 12)", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("horizon-today-closed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);

    const today = todaySaoPauloDate();
    await getDb()
      .insert(tradingSessions)
      .values({
        date: today,
        open: new Date(Date.now() - 8 * 60 * 60 * 1000),
        close: new Date(Date.now() - 1000),
      })
      .onConflictDoUpdate({
        target: tradingSessions.date,
        set: {
          open: new Date(Date.now() - 8 * 60 * 60 * 1000),
          close: new Date(Date.now() - 1000),
        },
      });

    await expect(
      recordDecisionAction({
        originKind: "signal",
        targetId: signal.id,
        kind: "enter",
        rationale: "Today's session has already closed",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: sessionDateSchema.parse(today),
      }),
    ).resolves.toEqual({ status: "error", error: "horizon_session_closed" });

    const repository = new DecisionsRepository(getDb(), owner);
    expect(await repository.listMine()).toEqual([]);
  });

  it("rejects a horizon of today when today is not a trading session at all", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("horizon-today-not-a-session");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const ticker = randomTicker();
    const signal = await createSignal(owner, ticker);

    const today = todaySaoPauloDate();
    await getDb().delete(tradingSessions).where(eq(tradingSessions.date, today));

    await expect(
      recordDecisionAction({
        originKind: "signal",
        targetId: signal.id,
        kind: "enter",
        rationale: "Today is not a trading session",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: sessionDateSchema.parse(today),
      }),
    ).resolves.toEqual({ status: "error", error: "horizon_session_closed" });

    const repository = new DecisionsRepository(getDb(), owner);
    expect(await repository.listMine()).toEqual([]);
  });
});

describe("recordDecisionAction on a held operation (ADR-0022)", () => {
  async function heldOperation(owner: CurrentUser) {
    const ticker = randomTicker();
    const seeded = await seedStockOperation(getDb(), owner, ticker, [
      { side: "buy", quantity: 200, price: "31.50", session: "2031-06-02" },
    ]);
    return { ticker, ...seeded };
  }

  it("user A cannot record a decision against user B's held operation", async () => {
    const emailA = uniqueEmail("held-isolation-a");
    const emailB = uniqueEmail("held-isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);
    const { operationId } = await heldOperation(userB);

    currentUser = userA;
    const result = await recordDecisionAction({
      originKind: "held_operation",
      targetId: operationId,
      kind: "hold",
      rationale: "Trying to decide on B's position",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_found" });
    expect(await new DecisionsRepository(getDb(), userA).listMine()).toEqual([]);
    expect(await new DecisionsRepository(getDb(), userB).listMine()).toEqual([]);
  });

  it("records a hold with the position as it stood, and keeps the operation grouped", async () => {
    const email = uniqueEmail("held-record");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const { ticker, operationId, fillIds } = await heldOperation(owner);

    const result = await recordDecisionAction({
      originKind: "held_operation",
      targetId: operationId,
      kind: "hold",
      rationale: "Trend intact",
      claim: { kind: "operation_pnl_positive" },
      confidence: confidenceSchema.parse("0.6"),
      horizon: "2031-06-15",
    });
    expect(result.status).toBe("ok");

    const repository = new DecisionsRepository(getDb(), owner);
    const [decision] = await repository.listMine();
    expect(decision?.originKind).toBe("held_operation");
    expect(decision?.operationId).toBe(operationId);
    expect(decision?.inputs).toEqual({
      originKind: "held_operation",
      underlying: ticker,
      expiry: null,
      openedAt: "2031-06-02",
      legs: [{ role: "stock", side: "buy", ticker, quantity: 200, entryPrice: "31.500000" }],
      fillIds,
    });
    expect((await repository.findLatestForHeldOperations([operationId])).get(operationId)?.id).toBe(
      decision?.id,
    );

    expect(await new PortfolioRepository(getDb(), owner).ungroup(operationId)).toEqual({
      ok: false,
      reason: "has_decisions",
    });
  });

  it("allows only hold, adjust and exit", async () => {
    const email = uniqueEmail("held-kind");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const { operationId } = await heldOperation(owner);

    const result = await recordDecisionAction({
      originKind: "held_operation",
      targetId: operationId,
      kind: "enter",
      rationale: "Already in",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_allowed" });
  });

  it("refuses an operation that is no longer open", async () => {
    const email = uniqueEmail("held-closed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const { operationId } = await seedStockOperation(getDb(), owner, randomTicker(), [
      { side: "buy", quantity: 100, price: "30", session: "2031-06-02" },
      { side: "sell", quantity: 100, price: "33", session: "2031-06-03" },
    ]);

    const result = await recordDecisionAction({
      originKind: "held_operation",
      targetId: operationId,
      kind: "exit",
      rationale: "Already closed",
      claim: null,
      confidence: confidenceSchema.parse("0.5"),
      horizon: "2031-06-15",
    });

    expect(result).toEqual({ status: "error", error: "not_found" });
  });

  // An option series that expired on 2024-05-17, for the two tests below.
  async function expiredOption(right: "call" | "put") {
    const underlying = randomTicker();
    const option = tickerSchema.parse(
      `O${crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`,
    );
    const removeSeries = await seedOptionSeries(getDb(), {
      ticker: option,
      underlying,
      right,
      strike: "32.00000000",
      expiry: "2024-05-17",
      listedOn: "2024-05-01",
    });
    return { underlying, option, removeSeries };
  }

  it("accepts a stock position whose options closed before an expiry that has passed", async () => {
    const email = uniqueEmail("held-options-closed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const { underlying, option, removeSeries } = await expiredOption("call");
    try {
      const { operationId } = await seedOperation(getDb(), owner, [
        { ticker: underlying, side: "buy", quantity: 100, price: "30", session: "2024-05-02" },
        {
          ticker: option,
          expiry: "2024-05-17",
          side: "sell",
          quantity: 100,
          price: "1.00",
          session: "2024-05-02",
        },
        {
          ticker: option,
          expiry: "2024-05-17",
          side: "buy",
          quantity: 100,
          price: "0.20",
          session: "2024-05-10",
        },
      ]);

      const result = await recordDecisionAction({
        originKind: "held_operation",
        targetId: operationId,
        kind: "hold",
        rationale: "Call bought back, keeping the shares",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: "2031-06-15",
      });
      expect(result.status).toBe("ok");

      const [decision] = await new DecisionsRepository(getDb(), owner).listMine();
      expect(decision?.inputs).toMatchObject({
        originKind: "held_operation",
        expiry: null,
        legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: 100 }],
      });
    } finally {
      await removeSeries();
    }
  });

  it("refuses an operation pending settlement: an option still open past its expiry", async () => {
    const email = uniqueEmail("held-pending-settlement");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const { option, removeSeries } = await expiredOption("put");
    try {
      const { operationId } = await seedOperation(getDb(), owner, [
        {
          ticker: option,
          expiry: "2024-05-17",
          side: "sell",
          quantity: 100,
          price: "1.00",
          session: "2024-05-02",
        },
      ]);

      const result = await recordDecisionAction({
        originKind: "held_operation",
        targetId: operationId,
        kind: "hold",
        rationale: "Expired, not settled yet",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: "2031-06-15",
      });
      expect(result).toEqual({ status: "error", error: "not_found" });
    } finally {
      await removeSeries();
    }
  });
});
