import { afterEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import {
  confidenceSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";
import { engine, type Proposal } from "@fetha/engine";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { buildOperationMarketView } from "@/modules/market-data";
import { tradingSessions } from "@/modules/market-data/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { SignalsRepository } from "@/modules/strategies/signals-repository";
import { StrategiesRepository } from "@/modules/strategies/strategies-repository";
import { StructuresRepository } from "@/modules/strategies/structures-repository";
import { structures } from "@/modules/strategies/schema";

import { decisions } from "./schema";
import { DecisionsRepository } from "./decisions-repository";
import type { DueDecisionRow } from "./decision-scores-repository";
import type { SignalDecisionInputs } from "./inputs";
import { buildScoreInput } from "./score-input";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-score-input-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`SI${suffix}`);
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
  const [calendarRow] = await getDb()
    .select({ close: tradingSessions.close })
    .from(tradingSessions)
    .where(eq(tradingSessions.date, session));
  if (!calendarRow) {
    throw new Error(`missing trading session ${session}`);
  }
  await upsertDailyCandles(getDb(), session, calendarRow.close, [row]);
}

function definition(): StrategyDefinition {
  return {
    name: "Score-input signal-origin test",
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

async function fetchDueDecisionRow(decisionId: string): Promise<DueDecisionRow> {
  const [row] = await getDb().select().from(decisions).where(eq(decisions.id, decisionId));
  if (!row) {
    throw new Error("test setup: expected a decision row");
  }
  return row;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

// buildScoreInput's signal-origin branch (#29 fix-web item 10): a real
// signal, a real strategy version and a proposal with real per-leg prices
// (from the engine's own `priceOperation`, the same call the signal's own
// proposal was built with), asserting the `Operation` this builds carries
// that proposal's own entry prices and the `origin` names the strategy
// version and structure.
describe("buildScoreInput signal-origin branch", () => {
  it("builds the Operation from the proposal's own legs and per-leg prices, with a signal origin", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("signal-origin-ok");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(horizonSession);
    await insertCandle(ticker, decidedSession, "40.000000");
    await insertCandle(ticker, horizonSession, "45.000000");

    const strategiesRepository = new StrategiesRepository(db, owner);
    const strategy = await strategiesRepository.createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");

    const decidedAt = new Date(`${decidedSession}T21:05:00.000Z`);
    const view = await buildOperationMarketView(db, ticker, decidedAt.toISOString());
    const leg = {
      role: "stock" as const,
      side: "buy" as const,
      ticker,
      quantity: quantitySchema.parse(100),
    };
    const pricing = await engine.priceOperation({
      view,
      at: decidedAt.toISOString(),
      legs: [leg],
      openOperationCount: 0,
    });
    if (!pricing.ok) {
      throw new Error(
        `test setup: expected pricing to succeed, got ${JSON.stringify(pricing.error)}`,
      );
    }
    const proposal: Proposal = { legs: [leg], pricing: pricing.value };

    const signalsRepository = new SignalsRepository(db, owner);
    await signalsRepository.createSignals([
      {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker,
        timeframe: "D1",
        session: decidedSession,
        at: decidedAt,
        kind: "entry",
        indicators: [],
        proposal,
        operationId: null,
        rule: null,
      },
    ]);
    const [signal] = await signalsRepository.listInbox();
    if (!signal) throw new Error("test setup: expected a signal");

    const inputs: SignalDecisionInputs = {
      originKind: "signal",
      strategyName: strategy.name,
      ticker,
      session: decidedSession,
      kind: "entry",
      indicators: [],
      proposal,
      rule: null,
    };

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "enter",
      originKind: "signal",
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId: version.id,
      inputs,
      rationale: "Signal-origin score-input integration test",
      claim: null,
      confidence: confidenceSchema.parse("0.6"),
      horizon: sessionDateSchema.parse(horizonSession),
      costModel: DEFAULT_COST_MODEL,
    });

    const dueRow = await fetchDueDecisionRow(decision.id);
    const catalog = await new StructuresRepository(db).listAll();
    const result = await buildScoreInput(db, owner, dueRow, catalog);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.origin).toMatchObject({
      kind: "signal",
      strategy: { id: version.id, definition: { structureId: "stock" } },
    });
    expect(result.input.operation?.legs).toHaveLength(1);
    expect(result.input.operation?.legs[0]?.entryPrice).toBe(pricing.value.legs[0]?.price);
    expect(result.input.operation?.underlying).toBe(ticker);
  });

  it("fails to build with missing_strategy_version when the strategy version cannot be found for this user", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("signal-origin-missing-version");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(horizonSession);

    const strategiesRepository = new StrategiesRepository(db, owner);
    const strategy = await strategiesRepository.createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");

    const proposal: Proposal = {
      legs: [{ role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) }],
      pricing: {
        at: `${decidedSession}T21:05:00.000Z` as never,
        underlying: ticker,
        spot: decimalStringSchema.parse("40"),
        riskFreeRate: decimalStringSchema.parse("0.1"),
        dividendYield: decimalStringSchema.parse("0"),
        legs: [
          {
            leg: { role: "stock", side: "buy", ticker, quantity: quantitySchema.parse(100) },
            price: decimalStringSchema.parse("40"),
            priceSource: "close",
            stale: null,
            fairValue: null,
            impliedVolatility: null,
            volatilitySource: null,
            greeks: null,
            timeToExpiryYears: null,
            notes: [],
          },
        ],
        netPremium: 400000 as never,
        greeks: { delta: null, gamma: null, theta: null, vega: null, rho: null } as never,
        payoff: [],
        breakEvens: [],
        maxLoss: 400000 as never,
        maxGain: "unbounded",
        limitBreaches: [],
        notes: [],
      } as never,
    };

    const inputs: SignalDecisionInputs = {
      originKind: "signal",
      strategyName: strategy.name,
      ticker,
      session: decidedSession,
      kind: "entry",
      indicators: [],
      proposal,
      rule: null,
    };

    const signalsRepository = new SignalsRepository(db, owner);
    await signalsRepository.createSignals([
      {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker,
        timeframe: "D1",
        session: decidedSession,
        at: new Date(`${decidedSession}T21:05:00.000Z`),
        kind: "entry",
        indicators: [],
        proposal,
        operationId: null,
        rule: null,
      },
    ]);
    const [signal] = await signalsRepository.listInbox();
    if (!signal) throw new Error("test setup: expected a signal");

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "enter",
      originKind: "signal",
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId: version.id,
      inputs,
      rationale: "Signal-origin score-input missing-version integration test",
      claim: null,
      confidence: confidenceSchema.parse("0.6"),
      horizon: sessionDateSchema.parse(horizonSession),
      costModel: DEFAULT_COST_MODEL,
    });

    const dueRow = await fetchDueDecisionRow(decision.id);
    const otherOwner = await insertBareUser(uniqueEmail("signal-origin-missing-version-other"));
    createdEmails.push(otherOwner.email);
    const catalog = await new StructuresRepository(db).listAll();
    // Built as `otherOwner`, not `owner`: `findVersionForScoring` scopes the
    // strategy version by the caller's own user id, so a version that is
    // real but belongs to a different user reads back the same as a version
    // that no longer resolves at all — the same isolation guarantee the
    // repository documents for itself.
    const result = await buildScoreInput(db, otherOwner, dueRow, catalog);

    expect(result).toEqual({ ok: false, reason: "missing_strategy_version" });
  });

  it("returns invalid_inputs instead of throwing when the stored confidence no longer parses (round 3 item 5)", async () => {
    const db = getDb();
    await ensureStockStructure();
    const email = uniqueEmail("signal-origin-invalid-confidence");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const decidedSession = sessionOffset(todaySessionDate(), -1);
    const horizonSession = sessionOffset(decidedSession, 5);
    await insertSession(decidedSession);
    await insertSession(horizonSession);
    await insertCandle(ticker, decidedSession, "40.000000");
    await insertCandle(ticker, horizonSession, "45.000000");

    const strategiesRepository = new StrategiesRepository(db, owner);
    const strategy = await strategiesRepository.createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");

    const decidedAt = new Date(`${decidedSession}T21:05:00.000Z`);
    const view = await buildOperationMarketView(db, ticker, decidedAt.toISOString());
    const leg = {
      role: "stock" as const,
      side: "buy" as const,
      ticker,
      quantity: quantitySchema.parse(100),
    };
    const pricing = await engine.priceOperation({
      view,
      at: decidedAt.toISOString(),
      legs: [leg],
      openOperationCount: 0,
    });
    if (!pricing.ok) {
      throw new Error(
        `test setup: expected pricing to succeed, got ${JSON.stringify(pricing.error)}`,
      );
    }
    const proposal: Proposal = { legs: [leg], pricing: pricing.value };

    const signalsRepository = new SignalsRepository(db, owner);
    await signalsRepository.createSignals([
      {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        ticker,
        timeframe: "D1",
        session: decidedSession,
        at: decidedAt,
        kind: "entry",
        indicators: [],
        proposal,
        operationId: null,
        rule: null,
      },
    ]);
    const [signal] = await signalsRepository.listInbox();
    if (!signal) throw new Error("test setup: expected a signal");

    const inputs: SignalDecisionInputs = {
      originKind: "signal",
      strategyName: strategy.name,
      ticker,
      session: decidedSession,
      kind: "entry",
      indicators: [],
      proposal,
      rule: null,
    };

    const decisionsRepository = new DecisionsRepository(db, owner);
    const decision = await decisionsRepository.record({
      kind: "enter",
      originKind: "signal",
      signalId: signal.id,
      contemplatedOperationId: null,
      strategyVersionId: version.id,
      inputs,
      rationale: "Invalid-confidence score-input integration test",
      claim: null,
      confidence: confidenceSchema.parse("0.6"),
      horizon: sessionDateSchema.parse(horizonSession),
      costModel: DEFAULT_COST_MODEL,
    });

    const dueRow = await fetchDueDecisionRow(decision.id);
    // The stored value read back can never be reproduced by the app's own
    // write path (`confidenceSchema` gates every write): this stands in for
    // a row an older app version wrote before the schema tightened, or one
    // edited directly, the only realistic way this parse ever fails.
    dueRow.confidence = "not-a-number";
    const catalog = await new StructuresRepository(db).listAll();
    const result = await buildScoreInput(db, owner, dueRow, catalog);

    expect(result).toEqual({ ok: false, reason: "invalid_inputs" });
  });
});
