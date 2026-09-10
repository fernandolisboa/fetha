import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { loadMarketView } from "@/modules/market-data";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { RiskProfileRepository } from "@/modules/portfolio";
import { WatchlistRepository } from "@/modules/watchlist";

import { CATCH_UP_SESSION_LIMIT, evaluateSignalsForSession } from "./evaluate-signals";
import { SignalsRepository } from "./signals-repository";
import { StrategiesRepository } from "./strategies-repository";

// Wraps the real implementation by default (round 3 item 1): every test
// keeps using genuine `loadMarketView` behaviour against the shared preview
// database except the one that overrides a single call with
// `mockImplementationOnce` to simulate a strategy's own loader throwing
// mid-loop, without touching every other DB read this module makes.
vi.mock("@/modules/market-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/market-data")>();
  return { ...actual, loadMarketView: vi.fn(actual.loadMarketView) };
});
const loadMarketViewMock = vi.mocked(loadMarketView);
const realLoadMarketView = loadMarketViewMock.getMockImplementation();
if (!realLoadMarketView) {
  throw new Error("expected loadMarketView mock to carry a base implementation");
}

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

// `count` consecutive calendar days from a random anchor, oldest first: the
// nightly evaluation's `since`/`at` catch-up range doesn't require a real B3
// trading calendar, just a distinct sequence of `date` rows.
function randomSessionSequence(count: number): string[] {
  const year = 2030 + Math.floor(Math.random() * 5);
  const month = 1 + Math.floor(Math.random() * 12);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
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

// `high`/`low`/`open`/`average` all derived from `close` (round 4 item 9):
// hardcoded values produced impossible bars once a test started passing a
// `close` outside their fixed 9-11 band (e.g. 22.50), harmless while only
// `close` is read but a trap for the first test that adds a range-based
// condition.
async function insertCandle(ticker: Ticker, session: string, close = "10.750000"): Promise<void> {
  const closeValue = new Decimal(close);
  const row = cotahistStockRowSchema.parse({
    kind: "stock",
    session,
    ticker,
    open: closeValue.toFixed(6),
    high: closeValue.times("1.02").toFixed(6),
    low: closeValue.times("0.98").toFixed(6),
    average: closeValue.toFixed(6),
    close,
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
  // Restores the pass-through default (round 3 item 1's `loadMarketView`
  // wrapper) even if a test overrode it, so a failure it throws never leaks
  // into an unrelated test after it.
  loadMarketViewMock.mockImplementation(realLoadMarketView);
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

  it("evaluates a three-session catch-up as one row per session per ticker and three signals, each signal priced at its own session's close, and a second call writes nothing new (round 2 item 5, round 3 item 6)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("three-session");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    // A distinct close per session (round 3 item 6): every session getting
    // the same candle would still pass a cardinality-only assertion even if
    // a regression priced every signal off the newest candle instead of its
    // own session's.
    const closeBySession: Record<string, string> = {
      [s1]: "11.000000",
      [s2]: "22.500000",
      [s3]: "33.750000",
    };

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      const close = closeBySession[session];
      if (!close) throw new Error("fixture setup failed");
      await insertCandle(ticker, session, close);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const first = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(first.errors).toEqual([]);
    expect(first.signalsWritten).toBe(3);
    expect(first.evaluationsWritten).toBe(3);

    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s1, s2, s3]));
    expect(log.every((row) => row.ticker === ticker)).toBe(true);

    const inbox = await repository.listInbox();
    expect(inbox).toHaveLength(3);
    for (const signal of inbox) {
      const expectedClose = closeBySession[signal.session];
      if (!expectedClose) throw new Error("unexpected session in inbox");
      expect(signal.proposal?.pricing.spot).toBe(expectedClose);
    }

    const second = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(second.errors).toEqual([]);
    expect(second.signalsWritten).toBe(0);
    expect(second.evaluationsWritten).toBe(0);
    expect(await repository.listEvaluationLog()).toHaveLength(3);
    expect(await repository.listInbox()).toHaveLength(3);
  });

  it("evaluates a user skipped by the deadline on session S for S on the next run (round 2 item 1)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("deadline-catchup");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    // Night 1: establishes the user's watermark at s1.
    const night1 = await evaluateSignalsForSession(db, [s1]);
    expect(night1.errors).toEqual([]);
    expect(night1.usersEvaluated).toBe(1);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listEvaluationLog()).toHaveLength(1);

    // Night 2: only session s2 is drained, but this user's deadline is
    // already spent — skipped entirely, watermark stays at s1.
    const night2 = await evaluateSignalsForSession(db, [s2], { deadlineAt: 0, now: () => 1 });
    expect(night2.usersSkipped).toBe(1);
    expect(night2.usersEvaluated).toBe(0);
    expect(await repository.listEvaluationLog()).toHaveLength(1);

    // Night 3: only session s3 is drained this run, no deadline this time.
    // The user's own watermark (s1), not this run's drained range, anchors
    // `since`, so s2 — never evaluated on night 2 — is caught up alongside
    // s3 instead of being lost forever.
    const night3 = await evaluateSignalsForSession(db, [s3]);
    expect(night3.errors).toEqual([]);
    expect(night3.usersEvaluated).toBe(1);

    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s1, s2, s3]));
    expect(await repository.listInbox()).toHaveLength(3);
  });

  it("picks up later a night's evaluation suppressed entirely (e.g. by an SGS failure gating the whole run), instead of losing it (round 2 item 1)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("suppressed-night");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const night1 = await evaluateSignalsForSession(db, [s1]);
    expect(night1.errors).toEqual([]);

    // Night 2 is never called at all (the cron's own gate — item 1's
    // route.ts fix — skipped it entirely; s2 candles still ingested
    // cleanly). Night 3 only drains s3.
    const night3 = await evaluateSignalsForSession(db, [s3]);
    expect(night3.errors).toEqual([]);

    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s1, s2, s3]));
  });

  it("writes one failure row per session in a multi-session catch-up, not only under the newest (round 2 item 6)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("unknown-structure");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const definition = {
      ...alwaysFiringDefinition(),
      structureId: `does-not-exist-${crypto.randomUUID()}`,
    };
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition);
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const outcome = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(outcome.errors).toEqual(["unknown_structure"]);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listInbox()).toHaveLength(0);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s1, s2, s3]));
    expect(log.every((row) => row.detail === "unknown_structure")).toBe(true);
  });

  it("resolves a genuinely missing anchor (no watermark, no session before the drained range) to a single explicit evaluation, never a crash or a silent no-op (round 2 item 7)", async () => {
    const db = getDb();
    // A session with nothing registered before it in the calendar at all —
    // this user's very first-ever evaluation, the only case `since` is
    // meant to stay `undefined`.
    const genesisSession = "2019-06-17";
    createdSessions.push(genesisSession);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("genesis");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(genesisSession);
    await insertCandle(ticker, genesisSession);
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const outcome = await evaluateSignalsForSession(db, [genesisSession]);
    expect(outcome.errors).toEqual([]);

    // Exactly one row for the genesis session — the explicit branch, not an
    // implicit fall-through that could silently evaluate zero or every
    // historical session once a real anchor eventually exists.
    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.session).toBe(genesisSession);
    expect(log[0]?.ticker).toBe(ticker);
  });

  it("excludes a stale, unregistered-session candle from a genuinely widened window (round 2 item 7, round 3 item 4)", async () => {
    const db = getDb();
    // Five real sessions so an sma(3) definition's window has to reach back
    // more than one session (round 3 item 4): the previous version of this
    // case re-ran the same already-covered session, which short-circuited
    // on the watermark before ever widening the window, so it never
    // actually exercised the calendar-bounded exclusion below.
    const sessions = randomSessionSequence(5);
    const [s0, s1, s2, s3, s4] = sessions;
    if (!s0 || !s1 || !s2 || !s3 || !s4) throw new Error("fixture setup failed");
    createdSessions.push(...sessions);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("stale-candle");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    for (const session of [s0, s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const definition: StrategyDefinition = {
      name: "SMA warm-up fixture",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "sma", length: 3 } },
        comparator: ">",
        right: { kind: "constant", value: decimalString("0") },
      },
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [],
    };
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition);
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    // Establishes the watermark at s3, using only s0..s3's real candles.
    const first = await evaluateSignalsForSession(db, [s3]);
    expect(first.errors).toEqual([]);

    // A candle with no registered trading session covering it (a halted
    // instrument's stale close from long before this window) is inserted
    // alongside s4's real one; the calendar-bounded query must exclude it
    // rather than pick it up as an arbitrarily stale candle keyed under its
    // own old session.
    const staleSession = "2018-01-02";
    await insertCandle(ticker, staleSession);
    await insertSession(s4);
    await insertCandle(ticker, s4);

    // Catch-up range is now just (s3, s4] — one session — but the sma(3)
    // window still has to reach back through s2 and s3's candles, genuinely
    // widening beyond the single newest session.
    const second = await evaluateSignalsForSession(db, [s4]);
    expect(second.errors).toEqual([]);

    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s3, s4]));
    expect(log.map((row) => row.session)).not.toContain(staleSession);

    // The session set alone is fixed by `since`/`at` and would pass even if
    // the window never actually widened past s4 (round 4 item 8): only the
    // newest row's `outcome` depends on the sma(3) warm-up genuinely
    // reaching back through s2 and s3's real candles rather than the stale
    // one — too narrow a window computes no sma value at s4 and records
    // `insufficient_data` instead of a fired signal.
    const newestRow = log.find((row) => row.session === s4);
    expect(newestRow?.outcome).toBe("signal");
    expect(newestRow?.detail).toBeNull();
  });

  it("records an explicit unsatisfiable-collection outcome for an iv_rank strategy instead of looping insufficient_data forever (round 2 item 8)", async () => {
    const db = getDb();
    const session = randomSession();
    createdSessions.push(session);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("iv-rank");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(session);
    await insertCandle(ticker, session);
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const definition: StrategyDefinition = {
      name: "IV rank fixture",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions: 20 } },
        comparator: ">",
        right: { kind: "constant", value: decimalString("50") },
      },
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [],
    };
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition);
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const outcome = await evaluateSignalsForSession(db, [session]);
    expect(outcome.errors).toEqual([]);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listInbox()).toHaveLength(0);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.detail).toBe("unsatisfiable_collection:impliedVolatilityIndex");
    expect(log[0]?.ticker).toBe(ticker);
  });

  it("keeps a sibling strategy's watermark independent when its own loader throws mid-loop, so the next run still catches it up on the sessions it missed (round 3 item 1)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("sibling-strategy-failure");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategyA = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategyA.id, true);
    const strategyB = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategyB.id, true);

    // Whichever strategy `listActiveDaily` processes first gets a real
    // `loadMarketView` call and commits; the second throws before it can
    // write anything (#19 round 3 item 1).
    let loadMarketViewCalls = 0;
    loadMarketViewMock.mockImplementation(async (...args) => {
      loadMarketViewCalls += 1;
      if (loadMarketViewCalls === 2) {
        throw new Error("transient market-data failure");
      }
      return realLoadMarketView(...args);
    });

    const first = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(first.errors).toContain("evaluation_failed");

    const repository = new SignalsRepository(db, owner);
    const logAfterFirst = await repository.listEvaluationLog();
    const strategiesWithRowsAfterFirst = new Set(logAfterFirst.map((row) => row.strategyId));
    // Exactly one of the two strategies committed anything: the per-user
    // watermark this round-3 fix removes would have let the surviving
    // strategy's write advance a shared watermark past the failing one.
    expect(strategiesWithRowsAfterFirst.size).toBe(1);

    const second = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(second.errors).toEqual([]);

    const logAfterSecond = await repository.listEvaluationLog();
    const countFor = (id: string): number =>
      logAfterSecond.filter((row) => row.strategyId === id).length;
    // Both strategies now cover all three sessions: the one that committed
    // in the first run was not re-evaluated (no duplicate rows past three),
    // and the one that failed was caught up on exactly the sessions it
    // missed, never lost.
    expect(countFor(strategyA.id)).toBe(3);
    expect(countFor(strategyB.id)).toBe(3);
    expect(new Set(logAfterSecond.map((row) => row.strategyId))).toEqual(
      new Set([strategyA.id, strategyB.id]),
    );
  });

  it("checks the deadline inside the strategy loop, not only between users (round 3 item 2)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("deadline-inside-loop");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    await insertSession(before);
    for (const session of [s1, s2, s3]) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategyA = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategyA.id, true);
    const strategyB = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategyB.id, true);

    // `now()` clears the deadline for the outer per-user check and the
    // first strategy, then trips it from the second strategy onward: a
    // deadline hit strictly inside the per-strategy loop, never only
    // between users.
    let calls = 0;
    const now = (): number => {
      calls += 1;
      return calls <= 2 ? 0 : 1_000;
    };

    const first = await evaluateSignalsForSession(db, [s1, s2, s3], { deadlineAt: 1_000, now });
    expect(first.errors).toEqual([]);
    expect(first.usersEvaluated).toBe(1);

    const repository = new SignalsRepository(db, owner);
    const logAfterFirst = await repository.listEvaluationLog();
    const strategiesWithRows = new Set(logAfterFirst.map((row) => row.strategyId));
    // Only the first-processed strategy got to run before the deadline hit
    // inside the loop; the other was left for the next run.
    expect(strategiesWithRows.size).toBe(1);

    const second = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(second.errors).toEqual([]);

    const logAfterSecond = await repository.listEvaluationLog();
    expect(new Set(logAfterSecond.map((row) => row.strategyId))).toEqual(
      new Set([strategyA.id, strategyB.id]),
    );
    const countFor = (id: string): number =>
      logAfterSecond.filter((row) => row.strategyId === id).length;
    expect(countFor(strategyA.id)).toBe(3);
    expect(countFor(strategyB.id)).toBe(3);
  });

  it("clamps a catch-up beyond the session limit and records the dropped span explicitly, instead of running it in full (round 3 item 2)", async () => {
    const db = getDb();
    const sessionCount = CATCH_UP_SESSION_LIMIT + 9;
    const sessions = randomSessionSequence(sessionCount);
    createdSessions.push(...sessions);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("clamp");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    for (const session of sessions) {
      await insertSession(session);
      await insertCandle(ticker, session);
    }
    await declareRiskProfile(owner);
    await new WatchlistRepository(db, owner).add(ticker);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    await new StrategiesRepository(db, owner).setActive(strategy.id, true);

    const oldest = sessions[0];
    const newest = sessions[sessions.length - 1];
    if (!oldest || !newest) throw new Error("fixture setup failed");

    // Establishes the watermark far in the past — a watchlist dormant for
    // weeks, or a deactivated-then-reactivated strategy.
    const night1 = await evaluateSignalsForSession(db, [oldest]);
    expect(night1.errors).toEqual([]);

    // Only the newest session is drained tonight, but the calendar still
    // carries every session registered since the watermark, implying a
    // catch-up of `sessionCount - 1` sessions — past the ceiling.
    const night2 = await evaluateSignalsForSession(db, [newest]);
    expect(night2.errors).toEqual([]);
    expect(night2.signalsWritten).toBe(CATCH_UP_SESSION_LIMIT);
    expect(night2.evaluationsWritten).toBe(CATCH_UP_SESSION_LIMIT + 1);

    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(CATCH_UP_SESSION_LIMIT + 2);

    const clampedCount = sessionCount - 1 - CATCH_UP_SESSION_LIMIT;
    const clampRow = log.find((row) => row.detail?.startsWith("catchup_clamped:"));
    expect(clampRow?.detail).toBe(`catchup_clamped:${String(clampedCount)}`);

    const evaluatedSessions = new Set(
      log.filter((row) => row.detail === null).map((row) => row.session),
    );
    const retainedSessions = sessions.slice(sessions.length - CATCH_UP_SESSION_LIMIT);
    expect(evaluatedSessions).toEqual(new Set([oldest, ...retainedSessions]));
    // The oldest session inside the clamped-away span never gets its own
    // evaluation row — it is only visible through the clamp record's count.
    expect(evaluatedSessions.has(sessions[1] as string)).toBe(false);
    // Sequential inserts/evaluations over `sessionCount` sessions and a
    // real 21-signal catch-up run past the default 20s test timeout.
  }, 60_000);

  it("counts a user whose active strategies are already caught up separately from one actually evaluated (round 3 item 3)", async () => {
    const db = getDb();
    const session = randomSession();
    createdSessions.push(session);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("already-caught-up");
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
    expect(first.usersEvaluated).toBe(1);
    expect(first.usersAlreadyCaughtUp).toBe(0);

    // A re-run for the same session with no correction: real work is
    // genuinely unnecessary, so it is counted as caught up, not evaluated —
    // the manual re-run the cron POST handler documents must be able to
    // tell the two apart.
    const second = await evaluateSignalsForSession(db, [session]);
    expect(second.errors).toEqual([]);
    expect(second.usersEvaluated).toBe(0);
    expect(second.usersAlreadyCaughtUp).toBe(1);
    expect(second.signalsWritten).toBe(0);

    const repository = new SignalsRepository(db, owner);
    expect(await repository.listInbox()).toHaveLength(1);
  });
});
