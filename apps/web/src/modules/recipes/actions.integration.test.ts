import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  centavosSchema,
  decimalStringSchema,
  sessionDateSchema,
  tickerSchema,
  type RiskProfile,
} from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { candles, tradingSessions } from "@/modules/market-data/schema";

let currentUser: CurrentUser | null = null;

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

const SESSIONS = businessDays("2097-06-02", 10);
const TODAY = sessionDateSchema.parse(SESSIONS.at(-1));

vi.mock("@/lib/today-sao-paulo", () => ({ todaySaoPauloDate: () => TODAY }));

// The read models these actions call write an access-log row (docs/adr/0027),
// which reads the request's headers.
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

const { startRecipeAction } = await import("./actions");
const { RiskProfileRepository } = await import("@/modules/portfolio");
const { StrategiesRepository, StrategyNotFoundError } = await import("@/modules/strategies");
const { WatchlistRepository } = await import("@/modules/watchlist");
const { BacktestRunNotFoundError } = await import("@/modules/backtests");
const { BacktestRunRepository } = await import("@/modules/backtests/backtest-run-repository");

const TICKER = tickerSchema.parse(
  `ZR${crypto.randomUUID().replaceAll("-", "").slice(0, 2).toUpperCase()}3`,
);
const NO_DATA_TICKER = tickerSchema.parse("ZRZZ4");

const PROFILE: RiskProfile = {
  declaredCapital: centavosSchema.parse(1_000_000),
  limits: {
    maxLossPerOperation: decimalStringSchema.parse("0.05"),
    maxExposurePerOperation: decimalStringSchema.parse("0.2"),
    maxOpenOperations: 3,
    maxPremiumBought: decimalStringSchema.parse("0.05"),
  },
};

const createdEmails: string[] = [];
const insertedSessions: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(candles).where(eq(candles.ticker, TICKER));
  const sessions = insertedSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  }
});

async function insertUser(label: string): Promise<CurrentUser> {
  const email = `fetha-recipes-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

async function seedCandles(): Promise<void> {
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
        ticker: TICKER,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 10,
        tradedQuantity: 1000,
      },
    ]);
  }
}

async function startExpectingRedirect(input: unknown): Promise<string> {
  try {
    const result = await startRecipeAction(input);
    throw new Error(`expected a redirect, got ${JSON.stringify(result)}`);
  } catch (error) {
    if (
      error instanceof Error &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT;")
    ) {
      return error.digest.split(";")[2] ?? "";
    }
    throw error;
  }
}

describe("startRecipeAction", () => {
  it("copies the recipe into the user's strategies, adds the ticker and opens a pending run", async () => {
    await seedCandles();
    const owner = await insertUser("owner");
    currentUser = owner;
    await new RiskProfileRepository(getDb(), owner).declare(PROFILE);

    const target = await startExpectingRedirect({
      recipeId: "bull-call-spread-low-iv",
      ticker: TICKER,
      riskFraction: "0.01",
    });

    const match = /^\/estrategias\/([^/]+)\/backtests\/([^/?]+)\?executar=1$/.exec(target);
    expect(match).not.toBeNull();
    const [, strategyId = "", runId = ""] = match ?? [];

    const strategy = await new StrategiesRepository(getDb(), owner).findMine(strategyId);
    expect(strategy.name).toBe(`Trava de alta com calls em ${TICKER}`);
    expect(strategy.active).toBe(false);
    expect(strategy.versions).toHaveLength(1);
    expect(strategy.versions[0]?.definition.sizing).toEqual({
      kind: "fixed_risk",
      fraction: "0.01",
    });
    expect(strategy.versions[0]?.definition.structureId).toBe("bull-call-spread");

    const watchlist = await new WatchlistRepository(getDb(), owner).list();
    expect(watchlist.map((item) => item.ticker)).toContain(TICKER);

    const run = await new BacktestRunRepository(getDb(), owner).findMine(runId);
    expect(run.status).toBe("pending");
    expect(run.strategyId).toBe(strategyId);
    expect(run.universe).toEqual([TICKER]);
    expect(run.initialCapital).toBe(PROFILE.declaredCapital);
    expect(run.period).toEqual({ from: SESSIONS[0], to: TODAY });
  });

  it("keeps the copy in its user's space: another user can neither read the strategy nor the run", async () => {
    await seedCandles();
    const owner = await insertUser("isolation-a");
    const other = await insertUser("isolation-b");
    await new RiskProfileRepository(getDb(), owner).declare(PROFILE);
    currentUser = owner;

    const target = await startExpectingRedirect({
      recipeId: "long-put-low-iv",
      ticker: TICKER,
      riskFraction: "0.02",
    });
    const [, strategyId = "", runId = ""] =
      /^\/estrategias\/([^/]+)\/backtests\/([^/?]+)/.exec(target) ?? [];

    await expect(
      new StrategiesRepository(getDb(), other).findMine(strategyId),
    ).rejects.toBeInstanceOf(StrategyNotFoundError);
    await expect(new BacktestRunRepository(getDb(), other).findMine(runId)).rejects.toBeInstanceOf(
      BacktestRunNotFoundError,
    );
    expect(await new StrategiesRepository(getDb(), other).listMine()).toEqual([]);
    expect(await new WatchlistRepository(getDb(), other).list()).toEqual([]);
  });

  it("creates nothing when the user has not declared a capital", async () => {
    await seedCandles();
    const owner = await insertUser("no-profile");
    currentUser = owner;

    const result = await startRecipeAction({
      recipeId: "long-call-low-iv",
      ticker: TICKER,
      riskFraction: "0.02",
    });

    expect(result).toEqual({ status: "error", error: "no_risk_profile" });
    expect(await new StrategiesRepository(getDb(), owner).listMine()).toEqual([]);
    expect(await new WatchlistRepository(getDb(), owner).list()).toEqual([]);
  });

  it("refuses a ticker with no quotes before creating a strategy", async () => {
    const owner = await insertUser("no-data");
    currentUser = owner;
    await new RiskProfileRepository(getDb(), owner).declare(PROFILE);

    const result = await startRecipeAction({
      recipeId: "long-call-low-iv",
      ticker: NO_DATA_TICKER,
      riskFraction: "0.02",
    });

    expect(result).toEqual({ status: "error", error: "no_data" });
    expect(await new StrategiesRepository(getDb(), owner).listMine()).toEqual([]);
  });

  it("refuses an unknown recipe, a risk fraction it does not offer and a bad ticker", async () => {
    currentUser = await insertUser("invalid");

    for (const input of [
      { recipeId: "nope", ticker: TICKER, riskFraction: "0.02" },
      { recipeId: "long-call-low-iv", ticker: TICKER, riskFraction: "0.5" },
      { recipeId: "long-call-low-iv", ticker: "not a ticker", riskFraction: "0.02" },
    ]) {
      expect(await startRecipeAction(input)).toEqual({ status: "error", error: "invalid" });
    }
  });
});
