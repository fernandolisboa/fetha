import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  centavosSchema,
  decimalStringSchema,
  tickerSchema,
  type ExpectedMove,
  type IvRegime,
  type Recipe,
  type RiskProfile,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  impliedVolatilityIndexPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";
import { recipes, StrategiesRepository, StructuresRepository } from "@/modules/strategies";

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

const SESSIONS = businessDays("2093-01-02", 140);
const EXPIRY_INDEXES = [100, 125];
const FIRST_PRICED_INDEX = 55;
const STRIKE_STEP = 0.25;

type Scenario = { move: ExpectedMove; iv: IvRegime; ticker: Ticker };

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 2).toUpperCase();
const SCENARIOS: Scenario[] = [
  { move: "up", iv: "low", ticker: tickerSchema.parse(`ZUL${suffix}3`) },
  { move: "up", iv: "high", ticker: tickerSchema.parse(`ZUH${suffix}3`) },
  { move: "down", iv: "low", ticker: tickerSchema.parse(`ZDL${suffix}3`) },
  { move: "down", iv: "high", ticker: tickerSchema.parse(`ZDH${suffix}3`) },
  { move: "sideways", iv: "any", ticker: tickerSchema.parse(`ZSA${suffix}3`) },
  { move: "big_move", iv: "low", ticker: tickerSchema.parse(`ZML${suffix}3`) },
];

// A drift with a short oscillation on top keeps RSI(14) away from its
// extremes, so the trend recipes' "not overbought / not oversold" filter
// holds while the close stays on the trend's side of its SMA(50).
function closeAt(move: ExpectedMove, index: number): number {
  const drift = move === "up" ? 0.0015 : move === "down" ? -0.0015 : 0;
  return 10 * (1 + drift * index) + 0.15 * Math.sin(index * 0.9);
}

// A falling IV ranks at 0 against its own last 63 sessions, a rising one at
// 100: the two ends of the IV regimes the recipes enter on.
function ivAt(regime: IvRegime, index: number): number {
  return regime === "high" ? 0.2 + 0.002 * index : 0.5 - 0.002 * index;
}

function money(value: number): string {
  return value.toFixed(2);
}

function strikesAround(move: ExpectedMove): number[] {
  const closes = SESSIONS.map((_session, index) => closeAt(move, index)).slice(FIRST_PRICED_INDEX);
  const low = Math.floor((Math.min(...closes) * 0.9) / STRIKE_STEP) * STRIKE_STEP;
  const high = Math.ceil((Math.max(...closes) * 1.1) / STRIKE_STEP) * STRIKE_STEP;
  const strikes: number[] = [];
  for (let strike = low; strike <= high + 1e-9; strike += STRIKE_STEP) {
    strikes.push(Math.round(strike * 100) / 100);
  }
  return strikes;
}

const GENEROUS: RiskProfile = {
  declaredCapital: centavosSchema.parse(1_000_000),
  limits: {
    maxLossPerOperation: decimalStringSchema.parse("1"),
    maxExposurePerOperation: decimalStringSchema.parse("1"),
    maxOpenOperations: 1,
    maxPremiumBought: decimalStringSchema.parse("1"),
  },
};

const tickers = SCENARIOS.map((scenario) => scenario.ticker);
const optionTickers: string[] = [];
const insertedSessions: string[] = [];
const createdEmails: string[] = [];

async function seedScenario(scenario: Scenario): Promise<void> {
  const db = getDb();
  for (const [index, session] of SESSIONS.entries()) {
    const close = decimalStringSchema.parse(money(closeAt(scenario.move, index)));
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      {
        kind: "stock",
        session,
        ticker: scenario.ticker,
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
    SESSIONS.map((session, index) => ({
      underlying: scenario.ticker,
      session,
      asOf: new Date(`${session}T20:00:00.000Z`),
      impliedVolatility: ivAt(scenario.iv, index).toFixed(4),
      method: "atm_30d_variance_interpolated" as const,
    })),
  );

  const series = EXPIRY_INDEXES.flatMap((expiryIndex, expiryOrdinal) =>
    strikesAround(scenario.move).flatMap((strike, strikeOrdinal) =>
      (["call", "put"] as const).map((right) => ({
        ticker: `${scenario.ticker.slice(0, 5)}${right === "call" ? "C" : "P"}${String(expiryOrdinal)}${String(strikeOrdinal).padStart(2, "0")}`,
        right,
        strike,
        expiryIndex,
      })),
    ),
  );
  optionTickers.push(...series.map((entry) => entry.ticker));
  await db.insert(optionSeries).values(
    series.map((entry) => ({
      isin: `ISIN-${entry.ticker}`,
      ticker: entry.ticker,
      underlying: scenario.ticker,
      right: entry.right,
      strike: money(entry.strike),
      expiry: SESSIONS[entry.expiryIndex] ?? "",
      style: "european" as const,
      asOf: new Date(`${SESSIONS[0] ?? ""}T13:00:00.000Z`),
    })),
  );

  const prices = series.flatMap((entry) =>
    SESSIONS.slice(FIRST_PRICED_INDEX, entry.expiryIndex + 1).map((session, offset) => {
      const index = FIRST_PRICED_INDEX + offset;
      const spot = closeAt(scenario.move, index);
      const intrinsic =
        entry.right === "call"
          ? Math.max(spot - entry.strike, 0)
          : Math.max(entry.strike - spot, 0);
      const timeValue = 0.25 * Math.sqrt((entry.expiryIndex - index) / 21);
      const price = money(Math.max(intrinsic + timeValue, 0.01));
      return {
        ticker: entry.ticker,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        right: entry.right,
        strike: money(entry.strike),
        expiry: SESSIONS[entry.expiryIndex] ?? "",
        average: price,
        close: price,
        trades: 10,
        tradedQuantity: 1000,
      };
    }),
  );
  for (let start = 0; start < prices.length; start += 1000) {
    await db.insert(optionDailyPrices).values(prices.slice(start, start + 1000));
  }
}

beforeAll(async () => {
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
  for (const month of new Set(SESSIONS.map((session) => session.slice(0, 7)))) {
    await ensureMonthlyPartition(db, "option_daily_prices", `${month}-01`);
  }
  for (const scenario of SCENARIOS) {
    await seedScenario(scenario);
  }
}, 120_000);

afterAll(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
  await db.delete(optionSeries).where(inArray(optionSeries.underlying, tickers));
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(inArray(impliedVolatilityIndexPoints.underlying, tickers));
  await db.delete(candles).where(inArray(candles.ticker, tickers));
  if (insertedSessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, insertedSessions));
  }
});

async function insertUser(): Promise<{ id: string; name: string; email: string }> {
  const email = `fetha-recipes-backtest-${crypto.randomUUID()}@example.com`;
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
  if (!row) throw new Error("failed to insert test user");
  return row;
}

async function operationsOf(recipe: Recipe, scenario: Scenario): Promise<number> {
  const db = getDb();
  const structure = (await new StructuresRepository(db).listAll()).find(
    (candidate) => candidate.id === recipe.definition.structureId,
  );
  if (!structure) throw new Error("the catalog must be seeded");

  const owner = await insertUser();
  const strategy = await new StrategiesRepository(db, owner).createWithVersion(recipe.definition);
  const version = strategy.versions[0];
  if (!version) throw new Error("expected a version");

  const repository = new BacktestRunRepository(db, owner);
  const run = await repository.create({
    strategyId: strategy.id,
    strategyVersionId: version.id,
    structure,
    universe: [scenario.ticker],
    period: { from: SESSIONS[0] ?? "", to: SESSIONS.at(-1) ?? "" },
    initialCapital: GENEROUS.declaredCapital,
    costModel: DEFAULT_COST_MODEL,
    riskProfile: GENEROUS,
    limits: "warn",
    sizing: version.definition.sizing,
    walkForward: null,
    seed: 1,
  });

  const outcome = await runBacktestChunk(db, owner, run.id, { maxSessions: 999 });
  expect(outcome.status).toBe("complete");

  const { result } = await repository.findMine(run.id);
  return result?.operations.length ?? 0;
}

function scenarioFor(move: ExpectedMove, iv: IvRegime): Scenario {
  const scenario = SCENARIOS.find(
    (candidate) => candidate.move === move && (iv === "any" || candidate.iv === iv),
  );
  if (!scenario) throw new Error(`no scenario for ${move}/${iv}`);
  return scenario;
}

describe("every recipe backtests end to end (#306)", () => {
  it.each(recipes.map((recipe) => [recipe.id, recipe] as const))(
    "%s: completes on a market that matches its expected move and IV regime, with an operation",
    async (_id, recipe) => {
      const scenario = scenarioFor(recipe.expectedMove, recipe.ivRegime);

      expect(await operationsOf(recipe, scenario)).toBeGreaterThan(0);
    },
    60_000,
  );

  it("stays out when the IV regime does not match: a low-IV recipe on rising IV never enters", async () => {
    const recipe = recipes.find((candidate) => candidate.id === "long-call-low-iv");
    if (!recipe) throw new Error("expected the long call recipe");

    expect(await operationsOf(recipe, scenarioFor("up", "high"))).toBe(0);
  }, 60_000);
});
