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
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";
import { StrategiesRepository, StructuresRepository } from "@/modules/strategies";
import { catalog } from "@/modules/strategies/catalog";

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

const SESSIONS = businessDays("2094-03-01", 40);
const EXPIRY = SESSIONS[30] ?? "";
const UNDERLYING = tickerSchema.parse(
  `ZC${crypto.randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase()}3`,
);
const CALLS = [
  { ticker: `${UNDERLYING.slice(0, 4)}C095`, strike: "9.50", price: "0.80" },
  { ticker: `${UNDERLYING.slice(0, 4)}C100`, strike: "10.00", price: "0.50" },
  { ticker: `${UNDERLYING.slice(0, 4)}C105`, strike: "10.50", price: "0.25" },
  { ticker: `${UNDERLYING.slice(0, 4)}C110`, strike: "11.00", price: "0.10" },
];

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
  const tickers = CALLS.map((call) => call.ticker);
  await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, tickers));
  await db.delete(optionSeries).where(eq(optionSeries.underlying, UNDERLYING));
  await db.delete(candles).where(eq(candles.ticker, UNDERLYING));
  const sessions = insertedSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  }
});

// The underlying closes at 10.00 every session, then at 10.80 on expiry:
// the 10.00 call ends in the money, the 10.50 one too, so a bull call
// spread entered at the money settles at its full width.
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
    const close = decimalStringSchema.parse(session === EXPIRY ? "10.80" : "10.00");
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
  await db.insert(optionSeries).values(
    CALLS.map((call) => ({
      isin: `ISIN-${call.ticker}`,
      ticker: call.ticker,
      underlying: UNDERLYING,
      right: "call" as const,
      strike: call.strike,
      expiry: EXPIRY,
      style: "european" as const,
      asOf: new Date(`${SESSIONS[0] ?? ""}T13:00:00.000Z`),
    })),
  );
  for (const month of new Set(SESSIONS.map((session) => session.slice(0, 7)))) {
    await ensureMonthlyPartition(db, "option_daily_prices", `${month}-01`);
  }
  await db.insert(optionDailyPrices).values(
    SESSIONS.filter((session) => session <= EXPIRY).flatMap((session) =>
      CALLS.map((call) => ({
        ticker: call.ticker,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        right: "call" as const,
        strike: call.strike,
        expiry: EXPIRY,
        average: call.price,
        close: call.price,
        trades: 10,
        tradedQuantity: 1000,
      })),
    ),
  );
}

async function insertUser(): Promise<{ id: string; name: string; email: string }> {
  const email = `fetha-catalog-backtest-${crypto.randomUUID()}@example.com`;
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

describe("a catalog entry backtests end to end (#20)", () => {
  it("runs the seeded bull call spread with its catalog defaults to a settled operation", async () => {
    const db = getDb();
    const entry = catalog.find((candidate) => candidate.structure.id === "bull-call-spread");
    const structure = (await new StructuresRepository(db).listAll()).find(
      (candidate) => candidate.id === "bull-call-spread",
    );
    if (!entry || !structure) throw new Error("the catalog must be seeded");
    expect(structure).toEqual(entry.structure);

    await seedMarket();
    const owner = await insertUser();
    const definition: StrategyDefinition = {
      name: "Trava de alta do catálogo",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "constant", value: decimalStringSchema.parse("9") },
      },
      structureId: structure.id,
      strikes: entry.defaults.strikes,
      ...(entry.defaults.expiry ? { expiry: entry.defaults.expiry } : {}),
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
      period: { from: SESSIONS[0] ?? "", to: SESSIONS[35] ?? "" },
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
    const [operation] = result?.operations ?? [];
    expect(operation?.legs.map((leg) => [leg.ticker, leg.side])).toEqual([
      [CALLS[1]?.ticker, "buy"],
      [CALLS[2]?.ticker, "sell"],
    ]);
    expect(operation).toMatchObject({ status: "expired", closedAt: EXPIRY });
    if (operation?.status !== "expired") throw new Error("expected an expired operation");
    expect(
      operation.settlement.map((leg) => [leg.leg.ticker, leg.outcome, leg.intrinsicValue]),
    ).toEqual([
      [CALLS[1]?.ticker, "exercised", "0.80"],
      [CALLS[2]?.ticker, "assigned", "0.30"],
    ]);
    // Hull's bull call spread at S_T above K2 pays K2 − K1 = 0.50 for a 0.25
    // debit: 4,000 units earn R$ 1.000,00 before costs and taxes.
    expect(operation.pnl).toBeGreaterThan(0);
    expect(operation.pnl).toBeLessThan(100_000);
  });
});
