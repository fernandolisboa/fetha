import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Centavos,
  DecimalString,
  RiskProfile,
  StrategyDefinition,
  Structure,
  Ticker,
} from "@fetha/contracts";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { candles } from "@/db/schema/market-data";
import { deleteTestUser } from "@/db/test/cleanup";
import { loadMarketView } from "@/modules/market-data";
import { upsertTradingSessions } from "@/modules/market-data/repositories/calendar-repository";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { RiskProfileRepository } from "@/modules/portfolio";
import { evaluateSignalsForSession, StrategiesRepository } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { DEFAULT_COST_MODEL } from "./default-config";
import { runBacktestChunk } from "./run-chunk";

// Wraps the real implementation (the same pattern
// evaluate-signals.integration.test.ts and actions.integration.test.ts
// already use): every call still hits the genuine `loadMarketView`, this
// only records the `DataWindow` each caller built.
vi.mock("@/modules/market-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/market-data")>();
  return { ...actual, loadMarketView: vi.fn(actual.loadMarketView) };
});
const loadMarketViewMock = vi.mocked(loadMarketView);

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function centavos(value: number): Centavos {
  return value as Centavos;
}

function ticker(value: string): Ticker {
  return tickerSchema.parse(value);
}

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

// 2101: disjoint from every other integration fixture's own "far future"
// literal (2097-2099 in market-view.integration.test.ts, 2098-2099 in
// option-repository.integration.test.ts, 2040-2044 in
// evaluate-signals.integration.test.ts), so this file's monthly partitions
// never collide with a sibling suite's own precondition.
const SESSIONS = businessDays(30, 2101, 2, 2);
const TICKER = ticker("ZDWP3");

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

// candlesNeeded = 20 (SMA length): enough of the 25 sessions before the
// anchor (index 25 of 30) exist to make warmup resolution actually matter,
// unlike a comparator against a constant, where earliestIndex is always 0
// regardless of `since`.
function smaDefinition(): StrategyDefinition {
  return {
    name: "SMA(20) parity fixture",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
  };
}

function fixtureRiskProfile(): RiskProfile {
  return {
    declaredCapital: centavos(100_000_00),
    limits: {
      maxLossPerOperation: decimalString("1"),
      maxExposurePerOperation: decimalString("1"),
      maxOpenOperations: 1000,
      maxPremiumBought: decimalString("1"),
    },
  };
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

const createdEmails: string[] = [];

afterEach(async () => {
  loadMarketViewMock.mockClear();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(candles).where(eq(candles.ticker, TICKER));
});

describe("run-chunk.ts and evaluate-signals.ts resolve warmup identically (#18 rebase: one shared test pinning both engine.dataWindow callers)", () => {
  it("loads the same warm-up window for a backtest anchored at a session's own open and a signal catch-up anchored at the immediately preceding session's close", async () => {
    const db = getDb();
    const email = `fetha-data-window-parity-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    await upsertTradingSessions(
      db,
      SESSIONS.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );
    for (const [index, session] of SESSIONS.entries()) {
      const close = decimalString((10 + index * 0.05).toFixed(2));
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

    const anchorSession = SESSIONS[25];
    if (!anchorSession) throw new Error("fixture setup failed");

    const strategy = await new StrategiesRepository(db, testUser).createWithVersion(
      smaDefinition(),
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    // The backtest side: a single-session run `{ from: anchorSession, to:
    // anchorSession }`, so `since` is exactly `anchorSession.open` —
    // run-chunk.ts's own anchor for the same session evaluate-signals.ts
    // (below) evaluates too.
    const run = await new BacktestRunRepository(db, testUser).create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: STOCK_STRUCTURE,
      universe: [TICKER],
      period: { from: anchorSession, to: anchorSession },
      initialCapital: centavos(1_000_000_00),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: fixtureRiskProfile(),
      limits: "enforce",
      sizing: version.definition.sizing,
      seed: 1,
    });

    const backtestOutcome = await runBacktestChunk(db, testUser, run.id, { maxSessions: 1 });
    if (backtestOutcome.status === "failed") {
      throw new Error(`backtest chunk failed: ${backtestOutcome.error}`);
    }
    const backtestCall = loadMarketViewMock.mock.calls.at(0);
    const backtestWindow = backtestCall?.[1];
    if (!backtestWindow) throw new Error("expected run-chunk.ts to have called loadMarketView");

    loadMarketViewMock.mockClear();

    // The signal side: this strategy version has no evaluation-log
    // watermark yet, so evaluate-signals.ts anchors `since` on
    // `previousTradingSession(oldest).close` — the close of the session
    // immediately before `anchorSession`, the same boundary the backtest's
    // own `since` (that session's *open*) represents for warmup purposes
    // (packages/engine/src/internal/data-window.ts computeFrom: closed vs.
    // not-yet-closed anchor session, one fewer session needed either way).
    await new WatchlistRepository(db, testUser).add(TICKER);
    await new RiskProfileRepository(db, testUser).declare(fixtureRiskProfile());
    await new StrategiesRepository(db, testUser).setActive(strategy.id, true);

    const signalOutcome = await evaluateSignalsForSession(db, [anchorSession]);
    expect(signalOutcome.errors).toEqual([]);
    const signalCall = loadMarketViewMock.mock.calls.at(0);
    const signalWindow = signalCall?.[1];
    if (!signalWindow)
      throw new Error("expected evaluate-signals.ts to have called loadMarketView");

    // Whole-window equality, not just `from`/`to` (round 5 item 8): `to`
    // alone is trivially equal in a single-session fixture regardless of
    // any real divergence, and `collections` is exactly the axis round 5
    // item 2 (the missing `impliedVolatilityIndex` refusal) diverged on —
    // a narrower assertion here would not have caught that class of bug.
    expect(signalWindow).toEqual(backtestWindow);
  }, 40_000);

  it("loads the same warm-up window for a recursive indicator and an option structure, across a longer span (round 5 item 8)", async () => {
    const db = getDb();
    const email = `fetha-data-window-parity-ema-${crypto.randomUUID()}@example.com`;
    createdEmails.push(email);
    const testUser = await insertBareUser(email);

    // A separate, longer session list from the SMA case above: EMA(10)'s
    // warmup is `10 x RECURSIVE_WARMUP_MULTIPLIER` (data-window.ts) = 30
    // sessions, and anchoring where fewer than 31 sessions precede it makes
    // BOTH callers clamp to `earliestIndex = 0` regardless of which anchor
    // boundary (session-open vs. preceding-session-close) each resolves —
    // the assertion below could not have told a correct implementation from
    // a broken one (round 6 item 4; the round-5 anchor at index 29 of a
    // 30-session calendar was exactly this vacuous case). Anchoring at
    // index 40 of 45 leaves 40 prior sessions, well past the 31 needed for
    // the computed `earliestIndex` to differ from 0 on either side, so a
    // caller that resolved the wrong boundary would show up in the loaded
    // candle count precisely because it disagreed with the other caller.
    const EMA_SESSIONS = businessDays(45, 2101, 6, 2);
    await upsertTradingSessions(
      db,
      EMA_SESSIONS.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );
    for (const [index, session] of EMA_SESSIONS.entries()) {
      const close = decimalString((10 + index * 0.05).toFixed(2));
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

    const anchorSession = EMA_SESSIONS[40];
    if (!anchorSession) throw new Error("fixture setup failed");

    // A strategy whose structure also carries an option leg (`collections`
    // must include `optionSeries`/`optionPrices` on both sides).
    // `structureId: "collar"` matches the shared catalog `db:seed-structures`
    // seeds (apps/web/scripts/seed-structures.mjs): evaluate-signals.ts
    // resolves the structure from that catalog, not from this fixture's own
    // literal, so the two must describe the same legs or the two sides'
    // `collections` would diverge for reasons unrelated to what this test
    // pins.
    const emaCollarDefinition: StrategyDefinition = {
      name: "EMA(10) collar parity fixture",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "indicator", indicator: { kind: "ema", length: 10 } },
      },
      structureId: "collar",
      // One strike selection per option leg, in leg order (put strikeRank
      // 1, call strikeRank 2): the engine requires `expiry` whenever
      // `strikes` is non-empty (strategy-definition.ts).
      strikes: [
        { kind: "moneyness", percent: decimalString("-0.05") },
        { kind: "moneyness", percent: decimalString("0.05") },
      ],
      expiry: { kind: "business_days", min: 5, max: 15 },
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [],
    };
    const COLLAR_STRUCTURE: Structure = {
      id: "collar",
      name: "Collar",
      expiry: "shared",
      legs: [
        { role: "stock", side: "buy", ratio: 1 },
        { role: "put", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
      ],
    };

    const strategy = await new StrategiesRepository(db, testUser).createWithVersion(
      emaCollarDefinition,
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("expected a version");

    const run = await new BacktestRunRepository(db, testUser).create({
      strategyId: strategy.id,
      strategyVersionId: version.id,
      structure: COLLAR_STRUCTURE,
      universe: [TICKER],
      period: { from: anchorSession, to: anchorSession },
      initialCapital: centavos(1_000_000_00),
      costModel: DEFAULT_COST_MODEL,
      riskProfile: fixtureRiskProfile(),
      limits: "enforce",
      sizing: version.definition.sizing,
      seed: 1,
    });

    const backtestOutcome = await runBacktestChunk(db, testUser, run.id, { maxSessions: 1 });
    if (backtestOutcome.status === "failed") {
      throw new Error(`backtest chunk failed: ${backtestOutcome.error}`);
    }
    const backtestWindow = loadMarketViewMock.mock.calls.at(0)?.[1];
    if (!backtestWindow) throw new Error("expected run-chunk.ts to have called loadMarketView");
    expect(backtestWindow.collections).toContain("optionSeries");
    expect(backtestWindow.collections).toContain("optionPrices");

    loadMarketViewMock.mockClear();

    await new WatchlistRepository(db, testUser).add(TICKER);
    await new RiskProfileRepository(db, testUser).declare(fixtureRiskProfile());
    await new StrategiesRepository(db, testUser).setActive(strategy.id, true);

    const signalOutcome = await evaluateSignalsForSession(db, [anchorSession]);
    expect(signalOutcome.errors).toEqual([]);
    const signalWindow = loadMarketViewMock.mock.calls.at(0)?.[1];
    if (!signalWindow)
      throw new Error("expected evaluate-signals.ts to have called loadMarketView");

    expect(signalWindow).toEqual(backtestWindow);
  }, 40_000);
});
