import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  instantSchema,
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
import { candles, tradingSessions } from "@/modules/market-data/schema";
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

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  for (const underlying of seededUnderlyings.splice(0)) {
    await db.delete(candles).where(eq(candles.ticker, underlying));
  }
  const dates = seededSessions.splice(0);
  if (dates.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
  }
});

interface ExecutedStockPlanFixture {
  owner: { id: string };
  operationId: string;
  entrySession: SessionDate;
  markSession: SessionDate;
}

// One stock-only held operation, bought at `entryPrice` on the first session and marked on the
// second at `markPrice`, with a single `profit_target` rule at `targetFraction` of the premium
// (ticket #381): exercises the nightly step end to end against the real engine pricing path
// (`loadPortfolio`), not a stub.
async function setupExecutedStockPlan(
  emailLabel: string,
  {
    entryPrice,
    markPrice,
    targetFraction,
  }: { entryPrice: string; markPrice: string; targetFraction: string },
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
  await planRulesRepo.save({
    contemplatedOperationId: contemplated.id,
    recipeId: "buy-and-hold",
    rules: {
      recipeId: "buy-and-hold",
      summary: "A Fetha montou essa posição.",
      exitRules: [
        {
          rule: {
            kind: "profit_target",
            fractionOfPremium: decimalStringSchema.parse(targetFraction),
          },
          session: null,
        },
      ],
      roll: { applies: false, session: null },
    },
  });
  const linked = await planRulesRepo.linkOperation(contemplated.id, operation.id);
  if (!linked.ok) throw new Error("failed to link operation");

  return { owner, operationId: operation.id, entrySession, markSession };
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
