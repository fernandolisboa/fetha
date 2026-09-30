import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  centavosSchema,
  decimalStringSchema,
  tickerSchema,
  type RiskProfile,
  type StrategyDefinition,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import {
  candles,
  impliedVolatilityIndexPoints,
  tradingSessions,
} from "@/modules/market-data/schema";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";

import { BacktestRunRepository } from "./backtest-run-repository";
import { DEFAULT_COST_MODEL } from "./default-config";
import { runBacktestChunk } from "./run-chunk";

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

const SESSIONS = businessDays("2095-05-01", 12);
const UNDERLYING = tickerSchema.parse(
  `ZV${crypto.randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase()}3`,
);
// Falls every session except the one at RISE_INDEX, so iv_rank over two
// sessions (100 when a point beats the one before it, 0 otherwise) reads
// above 50 on that session alone.
const RISE_INDEX = 7;
const IV_POINTS = SESSIONS.map((session, index) => ({
  session,
  impliedVolatility: (index === RISE_INDEX ? 0.5 : 0.4 - index * 0.01).toFixed(8),
}));

const GENEROUS: RiskProfile = {
  declaredCapital: centavosSchema.parse(1_000_000),
  limits: {
    maxLossPerOperation: decimalStringSchema.parse("1"),
    maxExposurePerOperation: decimalStringSchema.parse("1"),
    maxOpenOperations: 1,
    maxPremiumBought: decimalStringSchema.parse("1"),
  },
};

const createdEmails: string[] = [];
const insertedSessions: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(eq(impliedVolatilityIndexPoints.underlying, UNDERLYING));
  await db.delete(candles).where(eq(candles.ticker, UNDERLYING));
  const sessions = insertedSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  }
});

async function seedMarket(): Promise<void> {
  const db = getDb();
  const inserted = await db
    .insert(tradingSessions)
    .values(
      SESSIONS.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing()
    .returning({ date: tradingSessions.date });
  insertedSessions.push(...inserted.map((row) => row.date));
  for (const session of SESSIONS) {
    const close = decimalStringSchema.parse("10.00");
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      {
        kind: "stock",
        session,
        ticker: UNDERLYING,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      },
    ]);
  }
  await db.insert(impliedVolatilityIndexPoints).values(
    IV_POINTS.map((point) => ({
      underlying: UNDERLYING,
      session: point.session,
      asOf: new Date(`${point.session}T20:00:00.000Z`),
      impliedVolatility: point.impliedVolatility,
      method: "atm_30d_variance_interpolated" as const,
    })),
  );
}

async function insertUser(): Promise<{ id: string; name: string; email: string }> {
  const email = `fetha-iv-rank-backtest-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
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

describe("an iv_rank strategy backtests from stored IV index points (#264)", () => {
  it("enters on the one session whose iv_rank the stored points push above the threshold", async () => {
    const db = getDb();
    const structure = (await new StructuresRepository(db).listAll()).find(
      (candidate) => candidate.id === "stock",
    );
    if (!structure) throw new Error("the catalog must be seeded");

    await seedMarket();
    const owner = await insertUser();
    const definition: StrategyDefinition = {
      name: "Compra quando a IV sobe",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions: 2 } },
        comparator: ">",
        right: { kind: "constant", value: decimalStringSchema.parse("50") },
      },
      structureId: structure.id,
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalStringSchema.parse("0.1") },
      exit: [],
      adjustments: [],
    };
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition);
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const repository = new BacktestRunRepository(db, owner);
    const run = await repository.create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure,
      universe: [UNDERLYING],
      period: { from: SESSIONS[0] ?? "", to: SESSIONS.at(-1) ?? "" },
      initialCapital: centavosSchema.parse(1_000_000),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: GENEROUS,
      limits: "enforce",
      sizing: version.definition.sizing,
      walkForward: null,
      seed: 1,
    });

    const outcome = await runBacktestChunk(db, owner, run.id, { maxSessions: 999 });
    expect(outcome.status).toBe("complete");

    const { result } = await repository.findMine(run.id);
    expect(result?.operations).toHaveLength(1);
    // The signal on the rise session fills at the next session, never at
    // the close that produced it.
    expect(result?.operations[0]?.openedAt).toBe(SESSIONS[RISE_INDEX + 1]);
  });
});
