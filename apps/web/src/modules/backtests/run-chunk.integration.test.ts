import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type {
  Centavos,
  DecimalString,
  RiskProfile,
  StrategyDefinition,
  Structure,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { backtestRuns } from "@/db/schema/backtests";
import { user } from "@/db/schema/auth";
import { candles, optionSeries } from "@/db/schema/market-data";
import { deleteTestUser } from "@/db/test/cleanup";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { upsertTradingSessions } from "@/modules/market-data/repositories/calendar-repository";
import { StrategiesRepository } from "@/modules/strategies";

import {
  BacktestRunClaimError,
  BacktestRunRepository,
  type BacktestRunConfigInput,
} from "./backtest-run-repository";
import { DEFAULT_COST_MODEL } from "./default-config";
import { runBacktestChunk } from "./run-chunk";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

const TICKER = "ZQCT3";
// Alphabetically before TICKER: a naive round-trip that reorders the
// checkpoint's pending-entries map (e.g. by JS object key order after a
// `jsonb` round-trip, which does not preserve insertion order) would flip
// which of the two tickers wins the single open-operation slot below.
const TICKER2 = "AAAA3";
const SESSION_COUNT = 15;

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

// Starts the Monday before month-end: with 5-session chunks, the first
// chunk boundary (index 4/5) lands exactly on the January/February
// boundary, so the invariance test below also covers a month boundary
// inside a run, not only a chunk boundary.
const SESSIONS = businessDays(SESSION_COUNT, 2025, 1, 27);

// Crosses above 9 at index 4, the *last* session of the first 5-session
// chunk: the entry signal is decided in chunk 1 but only fillable at the
// next session's open, in chunk 2 — a pending entry that must survive the
// checkpoint round-trip across the chunk boundary.
function priceFor(index: number): string {
  const base = index < 4 ? 8.0 + index * 0.2 : 9.2 + (index - 4) * 0.2;
  return base.toFixed(2);
}

async function seedMarketData(): Promise<void> {
  const db = getDb();
  await upsertTradingSessions(
    db,
    SESSIONS.map((date) => ({
      date,
      open: `${date}T13:00:00.000Z`,
      close: `${date}T20:00:00.000Z`,
    })),
  );
  for (const [index, session] of SESSIONS.entries()) {
    const close = decimalString(priceFor(index));
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
      {
        kind: "stock",
        session,
        ticker: TICKER2,
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

function definition(): StrategyDefinition {
  return {
    name: "Testa cruza 9",
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
    exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.5") }],
    adjustments: [],
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(candles).where(eq(candles.ticker, TICKER));
  await db.delete(candles).where(eq(candles.ticker, TICKER2));
  await db.delete(optionSeries).where(eq(optionSeries.underlying, TICKER));
});

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

const COVERED_CALL_STRUCTURE: Structure = {
  id: "covered-call",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ],
};

// A single open-operation slot: with two tickers signaling entry on the
// same session, exactly one wins it, and *which* ticker wins is
// deterministic only if the pending-entry order the checkpoint persists
// survives its round-trip through the database unchanged.
const SINGLE_SLOT_RISK_PROFILE: RiskProfile = {
  declaredCapital: centavos(1_000_000),
  limits: {
    maxLossPerOperation: decimalString("1"),
    maxExposurePerOperation: decimalString("1"),
    maxOpenOperations: 1,
    maxPremiumBought: decimalString("1"),
  },
};

async function setUp(): Promise<{
  testUser: { id: string; name: string; email: string };
  strategyId: string;
  strategyVersionId: string;
  sizing: BacktestRunConfigInput["sizing"];
}> {
  const db = getDb();
  const email = `fetha-backtest-chunk-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  const testUser = await insertBareUser(email);

  await seedMarketData();

  const strategy = await new StrategiesRepository(db, testUser).createWithVersion(definition());
  const version = strategy.versions[0];
  if (!version) throw new Error("expected a version");

  return {
    testUser,
    strategyId: strategy.id,
    strategyVersionId: version.id,
    sizing: version.definition.sizing,
  };
}

function runConfig(setup: Awaited<ReturnType<typeof setUp>>): BacktestRunConfigInput {
  return {
    strategyId: setup.strategyId,
    strategyVersionId: setup.strategyVersionId,
    structure: STOCK_STRUCTURE,
    universe: [TICKER, TICKER2],
    period: { from: SESSIONS[0] ?? "", to: SESSIONS[SESSIONS.length - 1] ?? "" },
    initialCapital: centavos(1_000_000),
    costModel: DEFAULT_COST_MODEL,
    riskProfile: SINGLE_SLOT_RISK_PROFILE,
    limits: "enforce",
    sizing: setup.sizing,
    seed: 42,
  };
}

describe("runBacktestChunk", () => {
  it("a run split across three calls equals one uninterrupted run", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);

    const chunkedRun = await repository.create(runConfig(setup));
    const wholeRun = await repository.create(runConfig(setup));

    let chunkCalls = 0;
    let status: "paused" | "complete" = "paused";
    while (status === "paused") {
      chunkCalls += 1;
      const outcome = await runBacktestChunk(db, setup.testUser, chunkedRun.id, {
        maxSessions: 5,
      });
      if (outcome.status === "failed") {
        throw new Error(`chunk failed: ${outcome.error}`);
      }
      status = outcome.status;
    }
    expect(chunkCalls).toBe(3);

    const wholeOutcome = await runBacktestChunk(db, setup.testUser, wholeRun.id, {
      maxSessions: 999,
    });
    expect(wholeOutcome.status).toBe("complete");

    const chunkedFinal = await repository.findMine(chunkedRun.id);
    const wholeFinal = await repository.findMine(wholeRun.id);

    expect(chunkedFinal.status).toBe("complete");
    expect(JSON.stringify(chunkedFinal.result)).toBe(JSON.stringify(wholeFinal.result));
    expect(chunkedFinal.result?.operations.length ?? 0).toBeGreaterThan(0);

    // The single-slot limit means exactly one of the two tickers opened:
    // a checkpoint round-trip that reorders pendingEntries would let the
    // chunked run pick a different winner than the uninterrupted one.
    expect(chunkedFinal.result?.operations.length).toBe(1);
    expect(chunkedFinal.result?.operations[0]?.underlying).toBe(
      wholeFinal.result?.operations[0]?.underlying,
    );
    // In "enforce" mode the loser is a missed entry (reason
    // "limit_breach"), not a warned limit breach.
    expect(
      chunkedFinal.result?.missedEntries.some((entry) => entry.reason === "limit_breach"),
    ).toBe(true);
  });

  it("a completed run's row is immutable at the database level", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    const run = await repository.create(runConfig(setup));

    const outcome = await runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 999 });
    expect(outcome.status).toBe("complete");

    await expect(
      db.update(backtestRuns).set({ error: "tampered" }).where(eq(backtestRuns.id, run.id)),
    ).rejects.toThrow();
  });

  it("measures the wall-clock budget from the chunk's own start, so time already spent claiming and loading counts against it (round 3 item 4)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    const run = await repository.create(runConfig(setup));

    // The first `now()` call (chunkStart) reads 0; every call after that
    // jumps to 2000, as if the claim and the MarketView load alone had
    // already burned the whole clock. A 1000ms budget measured from
    // chunkStart is already exhausted before the loop's first deadline
    // check, so it must pause after exactly one inner step; measured from
    // whatever `now()` returns post-load (the pre-fix behaviour) it would
    // instead see a fresh 1000ms from that inflated reading and run to
    // completion in one pass.
    let calls = 0;
    const now = (): number => {
      calls += 1;
      return calls === 1 ? 0 : 2000;
    };

    const outcome = await runBacktestChunk(db, setup.testUser, run.id, {
      maxSessions: 999,
      innerStepSessions: 5,
      wallClockBudgetMs: 1000,
      now,
    });

    if (outcome.status !== "paused") {
      throw new Error(`expected "paused", got "${outcome.status}"`);
    }
    expect(outcome.sessionsDone).toBe(5);
    expect(outcome.sessionsTotal).toBe(SESSION_COUNT);
  });

  it("persists a checkpoint after each inner call and pauses at the wall-clock deadline even though the session budget allows more (round 1 item 19)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    const run = await repository.create(runConfig(setup));

    // A session budget generous enough to finish the whole 15-session
    // fixture in one inner call, but a wall-clock deadline that expires the
    // instant it is checked: the loop must still take its first 5-session
    // inner step, persist that checkpoint, and pause there rather than
    // either finishing anyway or losing the progress it already made.
    const outcome = await runBacktestChunk(db, setup.testUser, run.id, {
      maxSessions: 999,
      innerStepSessions: 5,
      wallClockBudgetMs: 0,
    });

    if (outcome.status !== "paused") {
      throw new Error(`expected "paused", got "${outcome.status}"`);
    }
    expect(outcome.sessionsDone).toBe(5);
    expect(outcome.sessionsTotal).toBe(SESSION_COUNT);

    const saved = await repository.findMine(run.id);
    expect(saved.status).toBe("paused");
    expect(saved.checkpoint).not.toBeNull();
    expect(saved.sessionsDone).toBe(5);

    // Resuming with a generous budget makes the rest of the progress and
    // reaches the same result the uninterrupted run does.
    let status: "paused" | "complete" = "paused";
    let guard = 0;
    while (status === "paused" && guard < 10) {
      guard += 1;
      const resumed = await runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 999 });
      if (resumed.status === "failed") {
        throw new Error(`chunk failed: ${resumed.error}`);
      }
      status = resumed.status;
    }
    expect(status).toBe("complete");
  });

  it("fails the run with no_market_data instead of throwing when loadMarketView reports the period unavailable (round 3 item 7)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    // Well before anything any test in this file (or a concurrent one) ever
    // seeds: `sessionsBetween` finds nothing in range, so `loadMarketView`
    // throws MarketViewUnavailableError instead of resolving a period.
    const run = await repository.create({
      ...runConfig(setup),
      period: { from: "1990-01-01", to: "1990-01-02" },
    });

    const outcome = await runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 999 });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.error).toBe("no_market_data");
    }

    const failed = await repository.findMine(run.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("no_market_data");
  });

  it("fails the run with market_view_too_large, not no_market_data, when the option chain crosses the cap (round 4 item 1)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);

    const firstSession = SESSIONS[0] ?? "";
    const expiry = SESSIONS[SESSIONS.length - 1] ?? "";
    for (let i = 0; i < 4; i += 1) {
      const optionTicker = `${TICKER}W${String(i)}`;
      await db.insert(optionSeries).values({
        isin: `ISIN-${optionTicker}`,
        ticker: optionTicker,
        underlying: TICKER,
        right: "call",
        strike: `${String(10 + i)}.00000000`,
        expiry,
        style: "european",
        asOf: new Date(`${firstSession}T13:00:00.000Z`),
      });
    }

    const run = await repository.create({
      ...runConfig(setup),
      structure: COVERED_CALL_STRUCTURE,
      universe: [TICKER],
    });

    const outcome = await runBacktestChunk(db, setup.testUser, run.id, {
      maxSessions: 999,
      optionChainTickerCap: 3,
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.error).toBe("market_view_too_large");
    }

    const failed = await repository.findMine(run.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("market_view_too_large");
  });

  it("fails the run rather than mix datasets when the market data changes between chunks (round 1 item 21)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    const run = await repository.create(runConfig(setup));

    const firstChunk = await runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 5 });
    if (firstChunk.status !== "paused") {
      throw new Error(`expected "paused", got "${firstChunk.status}"`);
    }
    const stamped = await repository.findMine(run.id);
    expect(stamped.dataVersion).not.toBeNull();

    // A revision to an already-loaded candle between chunks, on the run's
    // *last* session: dataVersion is `max(asOf)` over every loaded row, so
    // revising an earlier session's asOf to a later wall-clock time would
    // not move that maximum forward (its own session date still sorts
    // first); revising the last session's own asOf always does.
    const lastSession = SESSIONS.at(-1) ?? "";
    const revisedClose = decimalString("999.99");
    await upsertDailyCandles(db, lastSession, new Date(`${lastSession}T23:00:00.000Z`), [
      {
        kind: "stock",
        session: lastSession,
        ticker: TICKER,
        open: revisedClose,
        high: revisedClose,
        low: revisedClose,
        average: revisedClose,
        close: revisedClose,
        trades: 10,
        tradedQuantity: 1000,
      },
    ]);

    const secondChunk = await runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 999 });
    expect(secondChunk.status).toBe("failed");
    if (secondChunk.status === "failed") {
      expect(secondChunk.error).toBe("data_version_changed");
    }

    const failed = await repository.findMine(run.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("data_version_changed");
  });

  it("lets exactly one of two overlapping calls for the same run claim it, the other throws BacktestRunClaimError (round 2 item 3)", async () => {
    const db = getDb();
    const setup = await setUp();
    const repository = new BacktestRunRepository(db, setup.testUser);
    const run = await repository.create(runConfig(setup));

    const results = await Promise.allSettled([
      runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 5 }),
      runBacktestChunk(db, setup.testUser, run.id, { maxSessions: 5 }),
    ]);

    const fulfilled = results.filter((entry) => entry.status === "fulfilled");
    const rejected = results.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const [rejection] = rejected;
    if (rejection?.status !== "rejected") throw new Error("expected a rejection");
    expect(rejection.reason).toBeInstanceOf(BacktestRunClaimError);

    const final = await repository.findMine(run.id);
    expect(final.status === "paused" || final.status === "complete").toBe(true);
  });
});
