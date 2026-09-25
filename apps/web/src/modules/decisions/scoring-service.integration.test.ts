import { afterEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import {
  centavosSchema,
  confidenceSchema,
  quantitySchema,
  tickerSchema,
  type Centavos,
  type DecimalString,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { tradingSessions } from "@/modules/market-data/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { OperationsRepository } from "@/modules/portfolio/operations-repository";
import { structures } from "@/modules/strategies/schema";

import { DecisionScoresRepository } from "./decision-scores-repository";
import { DecisionsRepository } from "./decisions-repository";
import type { DecisionInputs } from "./inputs";
import { scoreDueDecisions } from "./scoring-service";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return centavosSchema.parse(value);
}

function uniqueEmail(label: string): string {
  return `fetha-scoring-service-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`SS${suffix}`);
}

function todaySessionDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sessionOffset(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

async function insertSession(session: string): Promise<void> {
  await getDb()
    .insert(tradingSessions)
    .values({
      date: session,
      open: new Date(`${session}T13:00:00.000Z`),
      close: new Date(`${session}T21:00:00.000Z`),
    })
    .onConflictDoNothing();
}

async function insertCandle(ticker: Ticker, session: string, close: string): Promise<void> {
  const closeValue = new Decimal(close);
  const row = cotahistStockRowSchema.parse({
    kind: "stock",
    session,
    ticker,
    open: closeValue.toFixed(6),
    high: closeValue.times("1.02").toFixed(6),
    low: closeValue.times("0.98").toFixed(6),
    average: closeValue.toFixed(6),
    close,
    trades: 100,
    tradedQuantity: 5000,
  });
  // The calendar row may predate this test with another close time (insertSession does
  // nothing on conflict); a candle stamped after the session close is invisible to score.
  const [calendarRow] = await getDb()
    .select({ close: tradingSessions.close })
    .from(tradingSessions)
    .where(eq(tradingSessions.date, session));
  if (!calendarRow) {
    throw new Error(`missing trading session ${session}`);
  }
  await upsertDailyCandles(getDb(), session, calendarRow.close, [row]);
}

function operationInputs(underlying: Ticker, session: string): DecisionInputs {
  return {
    originKind: "contemplated_operation",
    underlying,
    structureId: "stock",
    structureName: "Compra de ação",
    legs: [{ role: "stock", side: "buy", ticker: underlying, quantity: quantitySchema.parse(100) }],
    session,
    netPremiumCentavos: centavos(300000),
    maxLossCentavos: centavos(300000),
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

// Integration tests with the real engine, not a fake (#29 brief).
describe("scoreDueDecisions with the real engine", () => {
  // No candle is inserted before `decidedSession` here, so
  // `operationFromContemplatedInputs` (score-input.ts) cannot re-price the
  // snapshotted leg at `decidedAt` (no spot to resolve) and the operation
  // stays `null` — this decision is scored thesis-only (ADR-0014 Q46), not
  // because a contemplated-operation origin can never carry an operation
  // (see the "enter"/"do_not_enter" tests below), but because re-pricing
  // itself found nothing.
  it("scores a thesis-only decision's close_above claim against real candle data", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("real-engine-thesis-only");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    // A day before "now" (not today), so the session's own `open` timestamp
    // is guaranteed to fall before the decision's `decided_at` (`defaultNow()`
    // in `decisions-repository.ts`) regardless of the wall-clock time this
    // test itself runs at.
    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(horizonSession);
    await insertCandle(ticker, horizonSession, "45.000000");

    const operationRepository = new OperationsRepository(db, owner);
    const saved = await operationRepository.save({
      structureId: "stock",
      underlying: ticker,
      legs: [{ role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) }],
      session: decidedSession,
      netPremiumCentavos: centavos(300000),
      maxLossCentavos: centavos(300000),
      maxGainCentavos: null,
      breachedLimits: [],
    });

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "enter",
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: saved.id,
      strategyVersionId: null,
      inputs: operationInputs(ticker, decidedSession),
      rationale: "Real-engine thesis-only integration test",
      claim: { kind: "close_above", instrument: ticker, level: decimalString("40") },
      confidence: confidenceSchema.parse("0.7"),
      horizon: horizonSession,
      costModel: DEFAULT_COST_MODEL,
    });

    const outcome = await scoreDueDecisions(db, horizonSession);

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const scores = await scoresRepository.findForDecisions([decision.id]);
    const row = scores.get(decision.id);
    expect(row).toBeDefined();
    expect(row?.claimHeld).toBe(true);
    expect(row?.pnlCentavos).toBeNull();
    expect(row?.score.thesis.claim).not.toBeNull();
    expect(row?.engineVersion).toEqual(expect.any(String));

    const rerun = await scoreDueDecisions(db, horizonSession);
    expect(rerun.decisionsScored).toBe(0);
    expect((await scoresRepository.listMine())).toHaveLength(1);
  });

  // A candle at `decidedSession` gives `operationFromContemplatedInputs`
  // something to re-price the snapshotted stock leg against at `decidedAt`:
  // entryPrice R$ 40,00. A candle at `horizonSession` marks it to R$ 45,00.
  // pnl = (45 - 40) * 100 (centavos/real) * 100 (quantity) = 50 000 centavos.
  // maxLoss (long stock, unbounded upside) = entryPrice * quantity * 100 =
  // 400 000 centavos. normalizedPnl = 50 000 / 400 000 = 0.125.
  it("scores an enter decision's operation_pnl_positive claim with pnl, maxLoss and normalizedPnl", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("real-engine-enter-operation");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(horizonSession);
    await insertCandle(ticker, decidedSession, "40.000000");
    await insertCandle(ticker, horizonSession, "45.000000");

    const operationRepository = new OperationsRepository(db, owner);
    const saved = await operationRepository.save({
      structureId: "stock",
      underlying: ticker,
      legs: [{ role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) }],
      session: decidedSession,
      netPremiumCentavos: centavos(300000),
      maxLossCentavos: centavos(300000),
      maxGainCentavos: null,
      breachedLimits: [],
    });

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "enter",
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: saved.id,
      strategyVersionId: null,
      inputs: operationInputs(ticker, decidedSession),
      rationale: "Real-engine contemplated-operation enter integration test",
      claim: { kind: "operation_pnl_positive" },
      confidence: confidenceSchema.parse("0.7"),
      horizon: horizonSession,
      costModel: DEFAULT_COST_MODEL,
    });

    const outcome = await scoreDueDecisions(db, horizonSession);

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const scores = await scoresRepository.findForDecisions([decision.id]);
    const row = scores.get(decision.id);
    expect(row).toBeDefined();
    expect(row?.pnlCentavos).toBe(50000);
    expect(row?.maxLossCentavos).toBe(400000);
    expect(row?.maxLossUnbounded).toBe(false);
    expect(row?.normalizedPnl ? new Decimal(row.normalizedPnl).toString() : null).toEqual(
      new Decimal("0.125").toString(),
    );
    expect(row?.claimHeld).toBe(true);
  });

  // Same snapshot, but `do_not_enter`: `pnl` stays 0 (nothing was held) and
  // the counterfactual buys the leg the first session after `decidedSession`
  // (session open R$ 40,00, same as the entry candle) and marks it to
  // `horizonSession`'s R$ 45,00 close. Gross pnl 50 000 centavos, less the
  // B3 fee on the R$ 4 000,00 entry (0.05% => 200 centavos) =
  // 49 800 centavos.
  it("scores a do_not_enter decision's operation_pnl_positive claim with a counterfactualPnl", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("real-engine-do-not-enter-operation");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const entrySession = sessionOffset(decidedSession, 2);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(entrySession);
    await insertSession(horizonSession);
    await insertCandle(ticker, decidedSession, "40.000000");
    await insertCandle(ticker, entrySession, "40.000000");
    await insertCandle(ticker, horizonSession, "45.000000");

    const operationRepository = new OperationsRepository(db, owner);
    const saved = await operationRepository.save({
      structureId: "stock",
      underlying: ticker,
      legs: [{ role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) }],
      session: decidedSession,
      netPremiumCentavos: centavos(300000),
      maxLossCentavos: centavos(300000),
      maxGainCentavos: null,
      breachedLimits: [],
    });

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "do_not_enter",
      originKind: "contemplated_operation",
      signalId: null,
      contemplatedOperationId: saved.id,
      strategyVersionId: null,
      inputs: operationInputs(ticker, decidedSession),
      rationale: "Real-engine contemplated-operation do_not_enter integration test",
      claim: { kind: "operation_pnl_positive" },
      confidence: confidenceSchema.parse("0.3"),
      horizon: horizonSession,
      costModel: DEFAULT_COST_MODEL,
    });

    const outcome = await scoreDueDecisions(db, horizonSession);

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const scores = await scoresRepository.findForDecisions([decision.id]);
    const row = scores.get(decision.id);
    expect(row).toBeDefined();
    expect(row?.pnlCentavos).toBe(0);
    expect(row?.maxLossCentavos).toBe(400000);
    expect(row?.counterfactualPnlCentavos).toBe(49800);
    expect(row?.claimHeld).toBe(true);
  });
});
