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
import {
  addFills,
  addStockFill,
  seedOperation,
  seedOptionSeries,
  seedStockOperation,
} from "@/db/test/held-operation";
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

    const outcome = await scoreDueDecisions(db, { okSessions: [horizonSession] });

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const scores = await scoresRepository.findForDecisions([decision.id]);
    const row = scores.get(decision.id);
    expect(row).toBeDefined();
    expect(row?.claimHeld).toBe(true);
    expect(row?.pnlCentavos).toBeNull();
    expect(row?.score?.thesis.claim).not.toBeNull();
    expect(row?.engineVersion).toEqual(expect.any(String));

    const rerun = await scoreDueDecisions(db, { okSessions: [horizonSession] });
    expect(rerun.decisionsScored).toBe(0);
    expect(await scoresRepository.listMine()).toHaveLength(1);
  });

  // #29 fix-web item 4: the engine's own `score()` refuses a `ScoreInput`
  // whose `view.calendar` has no session at or before `decidedAt`
  // (packages/engine/src/internal/score.ts). With a horizon more than 30
  // sessions out, the old, unwidened trailing-30-from-horizon window would
  // silently drop `decidedAt`'s own session — this reproduces that gap with
  // 41 consecutive daily sessions between `decidedSession` and the horizon
  // (more than `CALENDAR_WINDOW_SESSIONS`) and asserts the decision still
  // scores end to end.
  it("scores a decision whose horizon is more than 30 sessions after decidedAt", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("real-engine-long-horizon");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 40);
    for (let i = 0; i <= 40; i += 1) {
      await insertSession(sessionOffset(decidedSession, i));
    }
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
      rationale: "Real-engine long-horizon integration test",
      claim: { kind: "close_above", instrument: ticker, level: decimalString("40") },
      confidence: confidenceSchema.parse("0.7"),
      horizon: horizonSession,
      costModel: DEFAULT_COST_MODEL,
    });

    const outcome = await scoreDueDecisions(db, { okSessions: [horizonSession] });

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const row = (await scoresRepository.findForDecisions([decision.id])).get(decision.id);
    expect(row).toBeDefined();
    expect(row?.score).not.toBeNull();
    expect(row?.unscorableReason).toBeNull();
    expect(row?.claimHeld).toBe(true);
  });

  // #29 fix-web item 5: a horizon stored on a non-trading date (here, a
  // fabricated calendar gap — no session row at all for `gapDate`) resolves
  // to the first trading session on or after it, and the decision scores
  // against that resolved session, not the raw stored date.
  it("scores a decision whose stored horizon lands on a date with no trading session", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("real-engine-non-session-horizon");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    // A date range far from the other tests in this file's own inserted
    // sessions (isolation from `trading_sessions` being shared, global
    // reference data, not scoped per test): otherwise a nearby test's own
    // insertion could accidentally fill in "the gap" this test relies on.
    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const gapDate = sessionOffset(decidedSession, 200);
    const resolvedSession = sessionOffset(decidedSession, 201);
    await insertSession(decidedSession);
    await insertSession(resolvedSession);
    await insertCandle(ticker, resolvedSession, "45.000000");

    // Deleted (and restored in `finally`) rather than merely assumed absent:
    // `trading_sessions` is shared, global reference data another
    // integration test file's own fixture (a seeded multi-year calendar)
    // could otherwise have already filled in for this exact synthetic date,
    // quietly defeating the one thing this test exists to exercise.
    const [existingGapSession] = await db
      .select()
      .from(tradingSessions)
      .where(eq(tradingSessions.date, gapDate));
    if (existingGapSession) {
      await db.delete(tradingSessions).where(eq(tradingSessions.date, gapDate));
    }

    try {
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
        rationale: "Real-engine non-session-horizon integration test",
        claim: { kind: "close_above", instrument: ticker, level: decimalString("40") },
        confidence: confidenceSchema.parse("0.7"),
        horizon: gapDate,
        costModel: DEFAULT_COST_MODEL,
      });

      const outcome = await scoreDueDecisions(db, { okSessions: [resolvedSession] });

      expect(outcome.errors).toEqual([]);
      expect(outcome.decisionsScored).toBe(1);

      const scoresRepository = new DecisionScoresRepository(db, owner);
      const row = (await scoresRepository.findForDecisions([decision.id])).get(decision.id);
      expect(row).toBeDefined();
      expect(row?.claimHeld).toBe(true);
    } finally {
      if (existingGapSession) {
        await db.insert(tradingSessions).values(existingGapSession).onConflictDoNothing();
      }
    }
  });

  // A candle at `decidedSession` gives `operationFromContemplatedInputs`
  // something to re-price the snapshotted stock leg against at `decidedAt`:
  // entryPrice R$ 40,00. A candle at `horizonSession` marks it to R$ 45,00.
  // Gross pnl = (45 - 40) * 100 (centavos/real) * 100 (quantity) =
  // 50 000 centavos, less the B3 fee on the R$ 4 000,00 entry (0.05% =>
  // 200 centavos) = 49 800 centavos (the taken-operation pnl subtracts its
  // own entry costs under the cost model, the same rule the counterfactual
  // below already followed). maxLoss (long stock, unbounded upside) =
  // entryPrice * quantity * 100 = 400 000 centavos. normalizedPnl =
  // 49 800 / 400 000 = 0.1245.
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

    const outcome = await scoreDueDecisions(db, { okSessions: [horizonSession] });

    expect(outcome.errors).toEqual([]);
    expect(outcome.decisionsScored).toBe(1);

    const scoresRepository = new DecisionScoresRepository(db, owner);
    const scores = await scoresRepository.findForDecisions([decision.id]);
    const row = scores.get(decision.id);
    expect(row).toBeDefined();
    expect(row?.pnlCentavos).toBe(49800);
    expect(row?.maxLossCentavos).toBe(400000);
    expect(row?.maxLossUnbounded).toBe(false);
    expect(row?.normalizedPnl ? new Decimal(row.normalizedPnl).toString() : null).toEqual(
      new Decimal("0.1245").toString(),
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

    const outcome = await scoreDueDecisions(db, { okSessions: [horizonSession] });

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

// ADR-0022 item 4: a decision on a held operation is scored on the position
// it was taken on (average cost as entry) and the portfolio's own fills
// after it, not on a re-priced snapshot. Fixed past sessions, apart from the
// dates the other tests here derive from today.
describe("scoreDueDecisions on a held operation", () => {
  const OPENED = "2024-07-01";
  const DECIDED = "2024-07-02";
  const PARTIAL_EXIT = "2024-07-03";
  const HORIZON = "2024-07-08";
  const SESSIONS = [OPENED, DECIDED, PARTIAL_EXIT, "2024-07-04", "2024-07-05", HORIZON];
  // DEFAULT_COST_MODEL's entry cost of 100 shares at R$ 30,00: 0,05% of R$ 3.000,00.
  const ENTRY_COSTS = 150;

  async function heldDecision(kind: "hold" | "exit") {
    const db = getDb();
    const email = uniqueEmail(`held-${kind}`);
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();
    for (const session of SESSIONS) {
      await insertSession(session);
      await insertCandle(ticker, session, session === HORIZON ? "36.000000" : "30.000000");
    }
    const { operationId, fillIds } = await seedStockOperation(db, owner, ticker, [
      { side: "buy", quantity: 100, price: "30", session: OPENED },
    ]);
    const decision = await new DecisionsRepository(db, owner).record({
      kind,
      originKind: "held_operation",
      signalId: null,
      contemplatedOperationId: null,
      operationId,
      strategyVersionId: null,
      inputs: {
        originKind: "held_operation",
        underlying: ticker,
        expiry: null,
        openedAt: OPENED,
        legs: [
          {
            role: "stock",
            side: "buy",
            ticker,
            quantity: quantitySchema.parse(100),
            entryPrice: decimalString("30.000000"),
          },
        ],
        fillIds,
      },
      rationale: `Held-operation ${kind} integration test`,
      claim: { kind: "operation_pnl_positive" },
      confidence: confidenceSchema.parse("0.6"),
      horizon: HORIZON,
      costModel: DEFAULT_COST_MODEL,
      decidedAt: new Date(`${DECIDED}T15:00:00.000Z`),
    });
    return { db, owner, ticker, operationId, decision };
  }

  it("realizes the part sold after the decision and marks the rest at the horizon close", async () => {
    const { db, owner, ticker, operationId, decision } = await heldDecision("hold");
    await addStockFill(db, owner, operationId, ticker, {
      side: "sell",
      quantity: 40,
      price: "34",
      session: PARTIAL_EXIT,
    });

    const outcome = await scoreDueDecisions(db, { okSessions: [HORIZON] });
    expect(outcome.errors.filter((error) => error.decisionId === decision.id)).toEqual([]);

    const row = (await new DecisionScoresRepository(db, owner).findForDecisions([decision.id])).get(
      decision.id,
    );
    // 40 × (34 − 30) realized + 60 × (36 − 30) marked, in centavos, net of entry costs.
    expect(row?.pnlCentavos).toBe(16000 + 36000 - ENTRY_COSTS);
    expect(row?.claimHeld).toBe(true);
  });

  it("scores an exit on the realized fill, net of its recorded costs", async () => {
    const { db, owner, ticker, operationId, decision } = await heldDecision("exit");
    await addStockFill(db, owner, operationId, ticker, {
      side: "sell",
      quantity: 100,
      price: "33",
      session: PARTIAL_EXIT,
      costsCentavos: 500,
    });

    await scoreDueDecisions(db, { okSessions: [HORIZON] });

    const row = (await new DecisionScoresRepository(db, owner).findForDecisions([decision.id])).get(
      decision.id,
    );
    expect(row?.unscorableReason).toBeNull();
    expect(row?.pnlCentavos).toBe(30000 - 500 - ENTRY_COSTS);
  });
});

// ADR-0022 item 4: an option still open once its expiry is inside the
// horizon waits for the user's settlement, whose fills then score the
// premium as realized P&L and follow the delivered stock to the horizon.
describe("scoreDueDecisions on a held operation with an expired option", () => {
  const OPENED = "2024-08-01";
  const DECIDED = "2024-08-02";
  const EXPIRY = "2024-08-09";
  const SESSIONS = [
    OPENED,
    DECIDED,
    "2024-08-05",
    "2024-08-06",
    "2024-08-07",
    "2024-08-08",
    EXPIRY,
  ];
  const AFTER_EXPIRY = ["2024-08-12", "2024-08-13", "2024-08-14", "2024-08-15", "2024-08-16"];
  // DEFAULT_COST_MODEL's entry costs: 0,05% of R$ 100,00 plus R$ 0,99
  // brokerage on the put, 0,05% of R$ 3.000,00 on the delivered stock.
  const PUT_ENTRY_COSTS = 5 + 99;
  const STOCK_ENTRY_COSTS = 150;
  const removals: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const remove of removals.splice(0)) {
      await remove();
    }
  });

  async function shortPutDecision() {
    const db = getDb();
    const email = uniqueEmail("held-short-put");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const underlying = randomTicker();
    const put = tickerSchema.parse(
      `P${crypto.randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`,
    );
    for (const session of [...SESSIONS, ...AFTER_EXPIRY]) {
      await insertSession(session);
      await insertCandle(underlying, session, session >= EXPIRY ? "28.000000" : "31.000000");
    }
    removals.push(
      await seedOptionSeries(db, {
        ticker: put,
        underlying,
        right: "put",
        strike: "30.00000000",
        expiry: EXPIRY,
        listedOn: OPENED,
      }),
    );
    const { operationId, fillIds } = await seedOperation(db, owner, [
      { ticker: put, expiry: EXPIRY, side: "sell", quantity: 100, price: "1.00", session: OPENED },
    ]);
    const decision = await new DecisionsRepository(db, owner).record({
      kind: "hold",
      originKind: "held_operation",
      signalId: null,
      contemplatedOperationId: null,
      operationId,
      strategyVersionId: null,
      inputs: {
        originKind: "held_operation",
        underlying,
        expiry: EXPIRY,
        openedAt: OPENED,
        legs: [
          {
            role: "put",
            side: "sell",
            ticker: put,
            quantity: quantitySchema.parse(100),
            entryPrice: decimalString("1.000000"),
          },
        ],
        fillIds,
      },
      rationale: "Holding the short put to expiry",
      claim: { kind: "operation_pnl_positive" },
      confidence: confidenceSchema.parse("0.6"),
      horizon: EXPIRY,
      costModel: DEFAULT_COST_MODEL,
      decidedAt: new Date(`${DECIDED}T15:00:00.000Z`),
    });
    return { db, owner, underlying, put, operationId, decision };
  }

  it("waits for the settlement, then scores the premium and the delivered stock", async () => {
    const { db, owner, underlying, put, operationId, decision } = await shortPutDecision();
    const scores = new DecisionScoresRepository(db, owner);

    await scoreDueDecisions(db, { okSessions: [EXPIRY] });
    expect((await scores.findForDecisions([decision.id])).get(decision.id)).toBeUndefined();

    await addFills(db, owner, operationId, [
      { ticker: put, expiry: EXPIRY, side: "buy", quantity: 100, price: "0", session: EXPIRY },
      { ticker: underlying, side: "buy", quantity: 100, price: "30", session: EXPIRY },
    ]);
    await scoreDueDecisions(db, { okSessions: [AFTER_EXPIRY[0] ?? EXPIRY] });

    const row = (await scores.findForDecisions([decision.id])).get(decision.id);
    expect(row?.unscorableReason).toBeNull();
    // 100 × 1,00 premium realized at zero, 100 × (28 − 30) on the delivered
    // stock, net of the model's entry costs on both legs.
    expect(row?.pnlCentavos).toBe(10000 - 20000 - PUT_ENTRY_COSTS - STOCK_ENTRY_COSTS);
    expect(row?.claimHeld).toBe(false);
  });

  it("settles at intrinsic once the retry window has passed without a settlement", async () => {
    const { db, owner, decision } = await shortPutDecision();

    await scoreDueDecisions(db, { okSessions: [AFTER_EXPIRY.at(-1) ?? EXPIRY] });

    const row = (await new DecisionScoresRepository(db, owner).findForDecisions([decision.id])).get(
      decision.id,
    );
    expect(row?.unscorableReason).toBeNull();
    expect(row?.pnlCentavos).not.toBeNull();
  });
});
