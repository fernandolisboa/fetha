import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  riskProfileSchema,
  tickerSchema,
  type DecimalString,
  type RiskProfile,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { candles, tradingSessions } from "@/db/schema/market-data";
import { deleteTestUser } from "@/db/test/cleanup";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { RiskProfileRepository } from "@/modules/portfolio";
import { WatchlistRepository } from "@/modules/watchlist";

import { evaluateSignalsForSession } from "./evaluate-signals";
import { SignalsRepository } from "./signals-repository";
import { StrategiesRepository } from "./strategies-repository";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-evaluate-signals-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`EV${suffix}`);
}

function randomSession(): string {
  const year = 2030 + Math.floor(Math.random() * 5);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 27);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

function generousRiskProfile(): RiskProfile {
  return riskProfileSchema.parse({
    declaredCapital: 100_000_00,
    limits: {
      maxLossPerOperation: "1",
      maxExposurePerOperation: "1",
      maxOpenOperations: 1000,
      maxPremiumBought: "1",
    },
  });
}

async function declareRiskProfile(owner: { id: string }): Promise<void> {
  await new RiskProfileRepository(getDb(), owner).declare(generousRiskProfile());
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

async function insertCandle(ticker: Ticker, session: string): Promise<void> {
  const row = cotahistStockRowSchema.parse({
    kind: "stock",
    session,
    ticker,
    open: "10.000000",
    high: "11.000000",
    low: "9.000000",
    average: "10.500000",
    close: "10.750000",
    trades: 100,
    tradedQuantity: 5000,
  });
  await upsertDailyCandles(getDb(), session, new Date(`${session}T21:00:00.000Z`), [row]);
}

// close > 0 always holds once a candle is ingested, so a signal fires
// deterministically without needing a longer warm-up window.
function alwaysFiringDefinition(): StrategyDefinition {
  return {
    name: "Sempre dispara",
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
const createdTickers: Ticker[] = [];
const createdSessions: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  for (const ticker of createdTickers.splice(0)) {
    await db.delete(candles).where(eq(candles.ticker, ticker));
  }
  for (const session of createdSessions.splice(0)) {
    await db.delete(tradingSessions).where(eq(tradingSessions.date, session));
  }
});

describe("evaluateSignalsForSession", () => {
  it("evaluates each user's active daily strategy over their own watchlist and never leaks a signal across users", async () => {
    const db = getDb();
    const session = randomSession();
    createdSessions.push(session);
    const tickerA = randomTicker();
    const tickerB = randomTicker();
    createdTickers.push(tickerA, tickerB);

    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    await insertSession(session);
    await insertCandle(tickerA, session);
    await insertCandle(tickerB, session);

    await declareRiskProfile(userA);
    await declareRiskProfile(userB);
    await new WatchlistRepository(db, userA).add(tickerA);
    await new WatchlistRepository(db, userB).add(tickerB);

    const strategyA = await new StrategiesRepository(db, userA).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, userA).setActive(strategyA.id, true);
    const strategyB = await new StrategiesRepository(db, userB).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, userB).setActive(strategyB.id, true);

    const outcome = await evaluateSignalsForSession(db, [session]);
    expect(outcome.errors).toEqual([]);

    const inboxA = await new SignalsRepository(db, userA).listInbox();
    const inboxB = await new SignalsRepository(db, userB).listInbox();

    expect(inboxA).toHaveLength(1);
    expect(inboxA[0]?.ticker).toBe(tickerA);
    expect(inboxA[0]?.strategyId).toBe(strategyA.id);

    expect(inboxB).toHaveLength(1);
    expect(inboxB[0]?.ticker).toBe(tickerB);
    expect(inboxB[0]?.strategyId).toBe(strategyB.id);

    // Neither user's inbox carries the other's strategy or ticker.
    expect(inboxA.some((signal) => signal.strategyId === strategyB.id)).toBe(false);
    expect(inboxB.some((signal) => signal.strategyId === strategyA.id)).toBe(false);

    const logA = await new SignalsRepository(db, userA).listEvaluationLog();
    const logB = await new SignalsRepository(db, userB).listEvaluationLog();
    expect(logA).toHaveLength(1);
    expect(logA.every((row) => row.ticker === tickerA)).toBe(true);
    expect(logB).toHaveLength(1);
    expect(logB.every((row) => row.ticker === tickerB)).toBe(true);
  });

  it("is idempotent: re-running the evaluation for the same session writes no duplicate signal or evaluation", async () => {
    const db = getDb();
    const session = randomSession();
    createdSessions.push(session);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("idempotent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(session);
    await insertCandle(ticker, session);
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const first = await evaluateSignalsForSession(db, [session]);
    expect(first.errors).toEqual([]);
    expect(first.signalsWritten).toBe(1);

    const second = await evaluateSignalsForSession(db, [session]);
    expect(second.errors).toEqual([]);
    expect(second.signalsWritten).toBe(0);
    expect(second.evaluationsWritten).toBe(0);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listInbox()).toHaveLength(1);
    expect(await repository.listEvaluationLog()).toHaveLength(1);
  });

  it("records an unsizeable evaluation and no inbox row for a user with no declared risk profile", async () => {
    const db = getDb();
    const session = randomSession();
    createdSessions.push(session);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("no-risk-profile");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(session);
    await insertCandle(ticker, session);
    // Deliberately no declareRiskProfile(owner) call: PLACEHOLDER_RISK_PROFILE
    // no longer fabricates one (round-1 review item 1).
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const outcome = await evaluateSignalsForSession(db, [session]);
    expect(outcome.errors).toEqual([]);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listInbox()).toHaveLength(0);

    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.outcome).toBe("unsizeable");
    expect(log[0]?.ticker).toBe(ticker);
  });
});
