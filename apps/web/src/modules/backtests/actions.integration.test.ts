import { afterEach, describe, expect, it, vi } from "vitest";
import type { Centavos, DecimalString, StrategyDefinition } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { and, gte, lte } from "drizzle-orm";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { tradingSessions } from "@/db/schema/market-data";
import { deleteTestUser } from "@/db/test/cleanup";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { upsertTradingSessions } from "@/modules/market-data/repositories/calendar-repository";
import { WatchlistRepository } from "@/modules/watchlist";

let currentUser: CurrentUser | null = null;

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

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

function uniqueEmail(label: string): string {
  return `fetha-backtest-actions-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<CurrentUser> {
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

const TICKER = "ZQAC3";

function businessDays(
  count: number,
  startYear: number,
  startMonth: number,
  startDay: number,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

const SESSIONS = businessDays(10, 2096, 3, 2);

function definition(): StrategyDefinition {
  return {
    name: "Estratégia sem tese",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("9") },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.2") },
    exit: [],
    adjustments: [],
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("createBacktestRunAction", () => {
  it("refuses to create a run when the user has not declared a risk profile", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");

    const email = uniqueEmail("no-profile");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await createBacktestRunAction({
      strategyId: "does-not-matter",
      strategyVersionId: "does-not-matter",
      universe: [TICKER],
      from: "2096-01-02",
      to: "2096-01-10",
      initialCapital: centavos(1_000_000),
      limits: "warn",
      costModel: "b3_default",
    });

    expect(result).toEqual({ status: "error", error: "no_risk_profile" });
  });

  it("takes the run's risk profile from the user's own declaration, not a fabricated unconstrained one", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");
    const { RiskProfileRepository } = await import("@/modules/portfolio");
    const { StrategiesRepository } = await import("@/modules/strategies");
    const { BacktestRunRepository } = await import("./backtest-run-repository");

    const db = getDb();
    const email = uniqueEmail("declared");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const declaredProfile = {
      declaredCapital: centavos(500_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.02"),
        maxExposurePerOperation: decimalString("0.1"),
        maxOpenOperations: 3,
        maxPremiumBought: decimalString("0.05"),
      },
    };
    await new RiskProfileRepository(db, currentUser).declare(declaredProfile);

    await upsertTradingSessions(
      db,
      SESSIONS.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );
    for (const session of SESSIONS) {
      const close = decimalString("10.00");
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
    await new WatchlistRepository(db, currentUser).add(TICKER);

    const strategy = await new StrategiesRepository(db, currentUser).createWithVersion(
      definition(),
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    let redirected = false;
    try {
      await createBacktestRunAction({
        strategyId: strategy.id,
        strategyVersionId: version.id,
        universe: [TICKER],
        from: SESSIONS[0] ?? "",
        to: SESSIONS.at(-1) ?? "",
        initialCapital: centavos(500_000_00),
        limits: "enforce",
        costModel: "b3_default",
      });
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      redirected = true;
    }
    expect(redirected).toBe(true);

    const runs = await new BacktestRunRepository(db, currentUser).listMineForStrategy(strategy.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.riskProfile).toEqual(declaredProfile);
  });

  it("rate limits creation after 10 requests in the window, the 11th returns rate_limited (round 2 item 5)", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");

    const email = uniqueEmail("rate-limit");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const input = {
      strategyId: "does-not-matter",
      strategyVersionId: "does-not-matter",
      universe: [TICKER],
      from: "2096-01-02",
      to: "2096-01-10",
      initialCapital: centavos(1_000_000),
      limits: "warn" as const,
      costModel: "b3_default" as const,
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await createBacktestRunAction(input);
      // No risk profile is declared for this user, so every one of the
      // first 10 requests reaches (and consumes) the rate limit before
      // failing on that later, unrelated check.
      expect(result).toEqual({ status: "error", error: "no_risk_profile" });
    }

    const eleventh = await createBacktestRunAction(input);
    expect(eleventh).toEqual({ status: "error", error: "rate_limited" });
  });

  it("persists the create request's own costModel, not the default preset, back on the run (round 2 item 16)", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");
    const { RiskProfileRepository } = await import("@/modules/portfolio");
    const { StrategiesRepository } = await import("@/modules/strategies");
    const { BacktestRunRepository } = await import("./backtest-run-repository");
    const { DISCOUNT_BROKER_COST_MODEL } = await import("./default-config");

    const db = getDb();
    const email = uniqueEmail("cost-model");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    await new RiskProfileRepository(db, currentUser).declare({
      declaredCapital: centavos(500_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.02"),
        maxExposurePerOperation: decimalString("0.1"),
        maxOpenOperations: 3,
        maxPremiumBought: decimalString("0.05"),
      },
    });

    await upsertTradingSessions(
      db,
      SESSIONS.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );
    for (const session of SESSIONS) {
      const close = decimalString("10.00");
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
    await new WatchlistRepository(db, currentUser).add(TICKER);

    const strategy = await new StrategiesRepository(db, currentUser).createWithVersion(
      definition(),
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    let redirected = false;
    try {
      await createBacktestRunAction({
        strategyId: strategy.id,
        strategyVersionId: version.id,
        universe: [TICKER],
        from: SESSIONS[0] ?? "",
        to: SESSIONS.at(-1) ?? "",
        initialCapital: centavos(500_000_00),
        limits: "enforce",
        costModel: "discount_broker",
      });
    } catch (error) {
      if (!isRedirectError(error)) throw error;
      redirected = true;
    }
    expect(redirected).toBe(true);

    const runs = await new BacktestRunRepository(db, currentUser).listMineForStrategy(strategy.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.costModel).toEqual(DISCOUNT_BROKER_COST_MODEL);
  });

  it("refuses a `from` the calendar carries but that has no ingested candle for any ticker in the universe (round 2 item 10)", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");
    const { RiskProfileRepository } = await import("@/modules/portfolio");
    const { StrategiesRepository } = await import("@/modules/strategies");

    const db = getDb();
    const email = uniqueEmail("no-candles");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    await new RiskProfileRepository(db, currentUser).declare({
      declaredCapital: centavos(500_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.02"),
        maxExposurePerOperation: decimalString("0.1"),
        maxOpenOperations: 3,
        maxPremiumBought: decimalString("0.05"),
      },
    });

    const uncoveredSessions = businessDays(5, 2093, 3, 1);
    await upsertTradingSessions(
      db,
      uncoveredSessions.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );

    await new WatchlistRepository(db, currentUser).add(TICKER);

    const strategy = await new StrategiesRepository(db, currentUser).createWithVersion(
      definition(),
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const result = await createBacktestRunAction({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      universe: [TICKER],
      from: uncoveredSessions[0] ?? "",
      to: uncoveredSessions.at(-1) ?? "",
      initialCapital: centavos(500_000_00),
      limits: "enforce",
      costModel: "b3_default",
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    await db
      .delete(tradingSessions)
      .where(
        and(
          gte(tradingSessions.date, uncoveredSessions[0] ?? ""),
          lte(tradingSessions.date, uncoveredSessions.at(-1) ?? ""),
        ),
      );
  });

  it("refuses a request whose sessions x universe exceeds what one chunk can hold (round 2 item 17)", async () => {
    vi.resetModules();
    const { createBacktestRunAction } = await import("./actions");
    const { RiskProfileRepository } = await import("@/modules/portfolio");

    const db = getDb();
    const email = uniqueEmail("session-ceiling");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    await new RiskProfileRepository(db, currentUser).declare({
      declaredCapital: centavos(500_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.02"),
        maxExposurePerOperation: decimalString("0.1"),
        maxOpenOperations: 3,
        maxPremiumBought: decimalString("0.05"),
      },
    });

    // 2,001 sessions x the 50-ticker universe ceiling = 100,050, just over
    // the 100,000 cap (round 2 item 17): only the calendar needs seeding
    // for this check, since it runs before the strategy, watchlist and
    // candle lookups.
    const hugeRange = businessDays(2001, 2050, 1, 3);
    await upsertTradingSessions(
      db,
      hugeRange.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );

    const universe = Array.from({ length: 50 }, (_, i) => `ZQ${i.toString().padStart(2, "0")}3`);

    const result = await createBacktestRunAction({
      strategyId: "does-not-matter",
      strategyVersionId: "does-not-matter",
      universe,
      from: hugeRange[0] ?? "",
      to: hugeRange.at(-1) ?? "",
      initialCapital: centavos(1_000_000),
      limits: "warn",
      costModel: "b3_default",
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    await db
      .delete(tradingSessions)
      .where(
        and(
          gte(tradingSessions.date, hugeRange[0] ?? ""),
          lte(tradingSessions.date, hugeRange.at(-1) ?? ""),
        ),
      );
  }, 30_000);
});
