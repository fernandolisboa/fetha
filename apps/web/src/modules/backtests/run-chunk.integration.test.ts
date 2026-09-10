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
import { candles } from "@/db/schema/market-data";
import { deleteTestUser } from "@/db/test/cleanup";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { upsertTradingSessions } from "@/modules/market-data/repositories/calendar-repository";
import { StrategiesRepository } from "@/modules/strategies";

import { BacktestRunRepository, type BacktestRunConfigInput } from "./backtest-run-repository";
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
});

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
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
});
