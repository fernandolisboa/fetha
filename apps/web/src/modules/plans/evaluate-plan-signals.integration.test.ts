import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { instantSchema, tickerSchema, type ContemplatedLeg, type Instant } from "@fetha/contracts";

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

// A stock-only held operation, bought on the first session and marked on the second at a price
// high enough to clear a 10% profit target (ticket #381): exercises the nightly step end to end
// against the real engine pricing path (`loadPortfolio`), not a stub.
describe("evaluatePlanSignals", () => {
  it("writes a target_hit signal once, deduplicated on a second run", async () => {
    await ensureStockStructure();
    const db = getDb();
    const email = uniqueEmail("ok");
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
      [entrySession, "10.000000"],
      [markSession, "15.000000"],
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
      price: "10.000000",
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
          { rule: { kind: "profit_target", fractionOfPremium: "0.1" as never }, session: null },
        ],
        roll: { applies: false, session: null },
      },
    });
    const linked = await planRulesRepo.linkOperation(contemplated.id, operation.id);
    expect(linked.ok).toBe(true);

    const first = await evaluatePlanSignals(db, markSession);
    expect(first.usersEvaluated).toBe(1);
    expect(first.signalsWritten).toBe(1);

    const signalsRepo = new PlanSignalsRepository(db, owner);
    const signals = await signalsRepo.listMine();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ kind: "target_hit", operationId: operation.id });

    const second = await evaluatePlanSignals(db, markSession);
    expect(second.signalsWritten).toBe(0);
    expect(await signalsRepo.listMine()).toHaveLength(1);
  });
});
