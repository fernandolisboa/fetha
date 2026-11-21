import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  structureSchema,
  tickerSchema,
  type ContemplatedLeg,
  type Instant,
  type SessionDate,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  corporateActionFactors,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";
import { loadPortfolio } from "@/modules/portfolio/portfolio-service";
import { contemplatedOperations, fills, operations } from "@/modules/portfolio/schema";
import { structures } from "@/modules/strategies/schema";

import { evaluatePlanSignals } from "./evaluate-plan-signals";
import { PlanRulesRepository } from "./plan-rules-repository";
import { PlanSignalsRepository } from "./plan-signals-repository";

function uniqueEmail(label: string): string {
  return `fetha-evaluate-plan-signals-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<{ id: string }> {
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
  if (!row) throw new Error("failed to insert test user");
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

async function ensureNakedCallStructure(): Promise<void> {
  const row = {
    id: "naked-call",
    name: "Venda de call a descoberto",
    legs: [{ role: "call", side: "sell", ratio: 1, strikeRank: 1 } as const],
  };
  structureSchema.parse({ ...row, expiry: "shared" });
  await getDb().insert(structures).values(row).onConflictDoNothing();
}

function businessDays(startIso: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function closeOf(session: string): Instant {
  return instantSchema.parse(`${session}T20:00:00.000Z`);
}

const createdEmails: string[] = [];
const seededUnderlyings: string[] = [];
const seededSessions: string[] = [];
const seededOptionTickers: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  const tickers = seededOptionTickers.splice(0);
  if (tickers.length > 0) {
    await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
    await db.delete(optionSeries).where(inArray(optionSeries.ticker, tickers));
  }
  for (const underlying of seededUnderlyings.splice(0)) {
    await db.delete(candles).where(eq(candles.ticker, underlying));
    await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, underlying));
  }
  const dates = seededSessions.splice(0);
  if (dates.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
  }
});

interface ExecutedStockPlanFixture {
  owner: { id: string };
  operationId: string;
  planRulesId: string;
  entrySession: SessionDate;
  markSession: SessionDate;
}

// One stock-only held operation, bought at `entryPrice` on the first session and marked on the
// second at `markPrice`, with a `profit_target` rule at `targetFraction`, a `stop_loss` rule at
// `stopMultiple` of the premium and/or a `days_before_expiry` rule resolved to the mark session
// (`expiryRuleDueAtMark`), and an optional corporate action on the underlying ex-dated the mark
// session (`corporateActionAtMark`, ticket #381): exercises the nightly step end to end against
// the real engine pricing path (`loadPortfolio`), not a stub.
async function setupExecutedStockPlan(
  emailLabel: string,
  {
    entryPrice,
    markPrice,
    targetFraction,
    stopMultiple,
    expiryRuleDueAtMark,
    corporateActionAtMark,
  }: {
    entryPrice: string;
    markPrice: string;
    targetFraction?: string;
    stopMultiple?: string;
    expiryRuleDueAtMark?: boolean;
    corporateActionAtMark?: boolean;
  },
): Promise<ExecutedStockPlanFixture> {
  await ensureStockStructure();
  const db = getDb();
  const email = uniqueEmail(emailLabel);
  createdEmails.push(email);
  const owner = await insertBareUser(email);

  const underlying = tickerSchema.parse(
    `Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}3`,
  );
  seededUnderlyings.push(underlying);
  const sessions = businessDays("1999-03-01", 2);
  const [entrySession, markSession] = sessions;
  if (!entrySession || !markSession) throw new Error("expected two sessions");

  await db
    .insert(tradingSessions)
    .values(
      sessions.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing();
  seededSessions.push(...sessions);

  for (const [session, close] of [
    [entrySession, entryPrice],
    [markSession, markPrice],
  ] as const) {
    await upsertDailyCandles(db, session, new Date(closeOf(session)), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker: underlying,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      }),
    ]);
  }

  const [operation] = await db
    .insert(operations)
    .values({ userId: owner.id, underlying, status: "open", openedAt: entrySession })
    .returning({ id: operations.id });
  if (!operation) throw new Error("failed to insert operation");
  await db.insert(fills).values({
    userId: owner.id,
    ticker: underlying,
    assetClass: "stock",
    side: "buy",
    quantity: 100,
    price: decimalStringSchema.parse(entryPrice),
    session: entrySession,
    costsCentavos: 0,
    source: "manual",
    operationId: operation.id,
  });

  if (corporateActionAtMark) {
    await db.insert(corporateActionFactors).values({
      ticker: underlying,
      exDate: markSession,
      asOf: new Date(closeOf(markSession)),
      factor: "2",
    });
  }

  const legs: ContemplatedLeg[] = [
    { role: "stock", side: "buy", ticker: underlying, quantity: 100 } as ContemplatedLeg,
  ];
  const [contemplated] = await db
    .insert(contemplatedOperations)
    .values({
      userId: owner.id,
      structureId: "stock",
      underlying,
      legs,
      session: entrySession,
      netPremiumCentavos: 100000,
      maxLossCentavos: 100000,
      maxGainCentavos: null,
      breachedLimits: [],
    })
    .returning({ id: contemplatedOperations.id });
  if (!contemplated) throw new Error("failed to insert contemplated operation");

  const planRulesRepo = new PlanRulesRepository(db, owner);
  const { id: planRulesId } = await planRulesRepo.save({
    contemplatedOperationId: contemplated.id,
    recipeId: "buy-and-hold",
    rules: {
      recipeId: "buy-and-hold",
      summary: "A Fetha montou essa posição.",
      exitRules: [
        ...(targetFraction
          ? [
              {
                rule: {
                  kind: "profit_target" as const,
                  fractionOfPremium: decimalStringSchema.parse(targetFraction),
                },
                session: null,
              },
            ]
          : []),
        ...(stopMultiple
          ? [
              {
                rule: {
                  kind: "stop_loss" as const,
                  multipleOfMaxLoss: decimalStringSchema.parse(stopMultiple),
                },
                session: null,
              },
            ]
          : []),
        ...(expiryRuleDueAtMark
          ? [
              {
                rule: { kind: "days_before_expiry" as const, businessDays: 5 },
                session: markSession,
              },
            ]
          : []),
      ],
      roll: { applies: false, session: null },
    },
  });
  const linked = await planRulesRepo.linkOperation(contemplated.id, operation.id);
  if (!linked.ok) throw new Error("failed to link operation");

  return { owner, operationId: operation.id, planRulesId, entrySession, markSession };
}

// A naked short call, struck at 30, sold at 1,00 (100 shares), marked deep in the money at a
// price *below* intrinsic (round 2 quant finding, #381): spot 34,20 against a strike of 30 puts
// intrinsic at 4,20, and the mark is 4,10 — below that floor, so the engine's own
// `iv_not_converged`/`below_intrinsic` notes fire on this leg. The mark itself, and the
// `unrealizedPnl` the engine derives from it, are still valid; only the greeks are not, so this
// must not be treated as an unreliable mark the way `no_market_price` is.
async function setupExecutedShortCallPlan(
  emailLabel: string,
  { stopMultiple }: { stopMultiple: string },
): Promise<ExecutedStockPlanFixture> {
  await ensureNakedCallStructure();
  const db = getDb();
  const email = uniqueEmail(emailLabel);
  createdEmails.push(email);
  const owner = await insertBareUser(email);

  const underlying = tickerSchema.parse(
    `Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}3`,
  );
  seededUnderlyings.push(underlying);
  const callTicker = tickerSchema.parse(`${underlying}C1`);
  seededOptionTickers.push(callTicker);

  const sessions = businessDays("1999-03-01", 10);
  const entrySession = sessions[0];
  const markSession = sessions[1];
  const expiry = sessions[9];
  if (!entrySession || !markSession || !expiry) throw new Error("expected ten sessions");

  await db
    .insert(tradingSessions)
    .values(
      sessions.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing();
  seededSessions.push(...sessions);

  for (const [session, close] of [
    [entrySession, "30.000000"],
    [markSession, "34.200000"],
  ] as const) {
    await upsertDailyCandles(db, session, new Date(closeOf(session)), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker: underlying,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      }),
    ]);
  }

  await db.insert(optionSeries).values({
    isin: `ISIN-${callTicker}`,
    ticker: callTicker,
    underlying,
    right: "call",
    strike: "30.00000000",
    expiry,
    style: "european",
    asOf: new Date(`${entrySession}T13:00:00.000Z`),
  });

  await ensureMonthlyPartition(db, "option_daily_prices", markSession);
  await db.insert(optionDailyPrices).values({
    ticker: callTicker,
    session: markSession,
    asOf: new Date(closeOf(markSession)),
    right: "call",
    strike: "30.00000000",
    expiry,
    average: "4.100000",
    close: "4.100000",
    trades: 5,
    tradedQuantity: 500,
  });

  const [operation] = await db
    .insert(operations)
    .values({ userId: owner.id, underlying, status: "open", openedAt: entrySession })
    .returning({ id: operations.id });
  if (!operation) throw new Error("failed to insert operation");
  await db.insert(fills).values({
    userId: owner.id,
    ticker: callTicker,
    assetClass: "option",
    side: "sell",
    quantity: 100,
    price: decimalStringSchema.parse("1.000000"),
    session: entrySession,
    expiry,
    costsCentavos: 0,
    source: "manual",
    operationId: operation.id,
  });

  const legs: ContemplatedLeg[] = [
    {
      role: "call",
      side: "sell",
      ticker: callTicker,
      quantity: quantitySchema.parse(100),
    },
  ];
  const [contemplated] = await db
    .insert(contemplatedOperations)
    .values({
      userId: owner.id,
      structureId: "naked-call",
      underlying,
      legs,
      session: entrySession,
      netPremiumCentavos: 10000,
      maxLossCentavos: null,
      maxGainCentavos: 10000,
      breachedLimits: [],
    })
    .returning({ id: contemplatedOperations.id });
  if (!contemplated) throw new Error("failed to insert contemplated operation");

  const planRulesRepo = new PlanRulesRepository(db, owner);
  const { id: planRulesId } = await planRulesRepo.save({
    contemplatedOperationId: contemplated.id,
    recipeId: "naked-call",
    rules: {
      recipeId: "naked-call",
      summary: "A Fetha montou essa posição.",
      exitRules: [
        {
          rule: {
            kind: "stop_loss",
            multipleOfMaxLoss: decimalStringSchema.parse(stopMultiple),
          },
          session: null,
        },
      ],
      roll: { applies: false, session: null },
    },
  });
  const linked = await planRulesRepo.linkOperation(contemplated.id, operation.id);
  if (!linked.ok) throw new Error("failed to link operation");

  return { owner, operationId: operation.id, planRulesId, entrySession, markSession };
}

describe("evaluatePlanSignals", () => {
  // Entry price 10,00, mark 15,00: a 100-share position opened at 1 000,00 (entry premium) is
  // worth 1 500,00 at today's mark. A 40% target against the entry-priced base (400,00) fires on
  // the 500,00 unrealized profit; against the mark-priced base it would need 600,00 and would
  // *not* fire — the exact drift review round 2's quant finding (#381) flagged, now covered by
  // asserting the fix's own outcome instead of the bug's.
  it("writes a target_hit signal once, deduplicated on a second run", async () => {
    const { owner, operationId, markSession } = await setupExecutedStockPlan("ok", {
      entryPrice: "10.000000",
      markPrice: "15.000000",
      targetFraction: "0.4",
    });
    const db = getDb();

    const first = await evaluatePlanSignals(db, markSession);
    expect(first.usersEvaluated).toBe(1);
    expect(first.signalsWritten).toBe(1);

    const signalsRepo = new PlanSignalsRepository(db, owner);
    const signals = await signalsRepo.listMine();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "target_hit", operationId });

    const second = await evaluatePlanSignals(db, markSession);
    expect(second.signalsWritten).toBe(0);
    expect(await signalsRepo.listMine()).toHaveLength(1);
  });

  // The entry-priced base, not the mark-priced one, decides whether the rule fires (review
  // round 2, #381): same move, a target fraction between the two bases' own thresholds.
  it("does not fire a target measured against today's mark premium instead of the entry premium", async () => {
    const { markSession } = await setupExecutedStockPlan("mark-vs-entry", {
      entryPrice: "10.000000",
      markPrice: "15.000000",
      // 50% of the mark-priced premium (1 500,00) is 750,00, above the 500,00 profit: the bug
      // this guards against would have this not fire. 50% of the entry-priced premium
      // (1 000,00) is 500,00, which the profit reaches exactly: the fixed code fires.
      targetFraction: "0.5",
    });
    const db = getDb();

    const outcome = await evaluatePlanSignals(db, markSession);
    expect(outcome.signalsWritten).toBe(1);
  });

  // The same entry-vs-mark drift as the profit_target test above, now for stop_loss (round 2
  // quant finding, #381): a stock bought at 10,00, marked at 6,00, 100 shares. The entry premium
  // (1 000,00, 100 000 centavos) is this stock's own max-loss base (a bought stock's own entry
  // cost); at a 0,5x multiple the entry-based threshold is −50 000 centavos. The actual loss is
  // (6,00 − 10,00) × 100 = −400,00 = −40 000 centavos, short of that threshold, so no signal. A
  // mark-priced base (600,00 × 0,5 = 30 000) would have this fire instead — this test fails if
  // `maxLossBaseCentavos` is ever read from today's `valuation.pricing` rather than the entry one.
  it("does not fire a stop measured against today's mark premium instead of the entry premium", async () => {
    const { markSession } = await setupExecutedStockPlan("stop-mark-vs-entry", {
      entryPrice: "10.000000",
      markPrice: "6.000000",
      stopMultiple: "0.5",
    });
    const db = getDb();

    const outcome = await evaluatePlanSignals(db, markSession);
    expect(outcome.signalsWritten).toBe(0);
  });

  // iv_not_converged is not an unreliable-mark note (round 2 quant finding, #381): a deep-ITM
  // short call priced below intrinsic still has a usable mark and unrealizedPnl, so its stop
  // must still fire. Entry premium 100,00 (10 000 centavos) is this naked call's own max-loss
  // base; at a 2x multiple the threshold is −20 000 centavos. The loss from mark 4,10 against
  // entry 1,00 is −(4,10 − 1,00) × 100 = −310,00 = −31 000 centavos, past the threshold.
  it("still fires a stop on a leg the engine could not converge an IV for", async () => {
    const { owner, operationId, markSession } = await setupExecutedShortCallPlan(
      "iv-not-converged",
      { stopMultiple: "2" },
    );
    const db = getDb();

    const read = await loadPortfolio(db, owner, closeOf(markSession));
    const operationRow = read.operations.find((row) => row.operation.id === operationId);
    expect(operationRow?.valuation?.pricing.notes.map((note) => note.code)).toContain(
      "iv_not_converged",
    );

    const outcome = await evaluatePlanSignals(db, markSession);
    expect(outcome.signalsWritten).toBe(1);
  });

  // Clearing a stale alert for a position the user no longer holds (round 2 correctness finding,
  // #381): the operation closes between nightly runs, and the already-written target_hit must
  // not linger on `/sinais` forever.
  it("clears every alert kind once the linked operation is no longer open", async () => {
    const { owner, operationId, markSession } = await setupExecutedStockPlan("closes-after", {
      entryPrice: "10.000000",
      markPrice: "15.000000",
      targetFraction: "0.4",
    });
    const db = getDb();

    const first = await evaluatePlanSignals(db, markSession);
    expect(first.signalsWritten).toBe(1);
    const signalsRepo = new PlanSignalsRepository(db, owner);
    expect(await signalsRepo.listMine()).toHaveLength(1);

    await db
      .update(operations)
      .set({ status: "closed", closedAt: markSession })
      .where(eq(operations.id, operationId));

    const second = await evaluatePlanSignals(db, markSession);
    expect(second.signalsCleared).toBe(1);
    expect(await signalsRepo.listMine()).toHaveLength(0);
  });

  // The price-based skip branch, end to end (quant advisory, #381 round 3): a corporate action
  // on the underlying after the operation opened makes `entryPayoff.kind` "adjusted", not
  // "priced" (`adjustedSinceOpening`), so there is no entry-priced base to measure a target
  // against at all — `target_hit` is neither fired nor cleared, while `expiry_near` (no price
  // needed) still fires, and a `target_hit` row written before the corporate action survives
  // this run untouched.
  it("skips target_hit with no price bases, still fires expiry_near, and leaves a pre-existing target_hit alone", async () => {
    const { owner, operationId, planRulesId, markSession } = await setupExecutedStockPlan(
      "corporate-action-skip",
      {
        entryPrice: "10.000000",
        markPrice: "15.000000",
        targetFraction: "0.1",
        expiryRuleDueAtMark: true,
        corporateActionAtMark: true,
      },
    );
    const db = getDb();
    const signalsRepo = new PlanSignalsRepository(db, owner);
    await signalsRepo.createMany([
      {
        operationPlanRulesId: planRulesId,
        operationId,
        kind: "target_hit",
        session: markSession,
        at: closeOf(markSession),
      },
    ]);

    const outcome = await evaluatePlanSignals(db, markSession);
    expect(outcome.signalsWritten).toBe(1);

    const signals = await signalsRepo.listMine();
    expect(signals.map((signal) => signal.kind).sort()).toEqual(["expiry_near", "target_hit"]);
  });

  // Isolation (CLAUDE.md: a job can never read, write or act for another user's data): two
  // users, each with their own executed plan on their own operation, evaluated in the same
  // nightly run — each ends up with only their own signal, under their own `user_id`.
  it("evaluates two users' plans in the same run without crossing their signals", async () => {
    const fixtureA = await setupExecutedStockPlan("multi-a", {
      entryPrice: "10.000000",
      markPrice: "15.000000",
      targetFraction: "0.4",
    });
    const fixtureB = await setupExecutedStockPlan("multi-b", {
      entryPrice: "20.000000",
      markPrice: "30.000000",
      targetFraction: "0.4",
    });
    const db = getDb();

    const outcome = await evaluatePlanSignals(db, fixtureA.markSession);
    expect(outcome.usersEvaluated).toBe(2);

    const signalsA = await new PlanSignalsRepository(db, fixtureA.owner).listMine();
    expect(signalsA).toHaveLength(1);
    expect(signalsA[0]?.operationId).toBe(fixtureA.operationId);

    const signalsB = await new PlanSignalsRepository(db, fixtureB.owner).listMine();
    expect(signalsB).toHaveLength(1);
    expect(signalsB[0]?.operationId).toBe(fixtureB.operationId);
  });
});
