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

  it("evaluates a three-session catch-up as one row per session per ticker and three signals, and a second call writes nothing new (round 2 item 5)", async () => {
    const db = getDb();
    const [before, s1, s2, s3] = randomSessionSequence(4);
    if (!before || !s1 || !s2 || !s3) throw new Error("fixture setup failed");
    createdSessions.push(before, s1, s2, s3);
    const ticker = randomTicker();
    createdTickers.push(ticker);

    const email = uniqueEmail("three-session");
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

    const first = await evaluateSignalsForSession(db, [s1, s2, s3]);
    expect(first.errors).toEqual([]);
    expect(first.signalsWritten).toBe(3);
    expect(first.evaluationsWritten).toBe(3);

    const repository = new SignalsRepository(db, owner);
    const log = await repository.listEvaluationLog();
    expect(log).toHaveLength(3);
    expect(new Set(log.map((row) => row.session))).toEqual(new Set([s1, s2, s3]));
    expect(log.every((row) => row.ticker === ticker)).toBe(true);
    expect(await repository.listInbox()).toHaveLength(3);

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

    // A candle with no registered trading session covering it (a halted
    // instrument's stale close from long before this window) is excluded by
    // the calendar-bounded query rather than picked up as an arbitrarily
    // stale candle keyed under its own old session.
    const staleSession = "2018-01-02";
    await insertCandle(ticker, staleSession);
    const rerun = await evaluateSignalsForSession(db, [genesisSession]);
    expect(rerun.errors).toEqual([]);
    const logAfterStaleCandle = await repository.listEvaluationLog();
    expect(logAfterStaleCandle.map((row) => row.session)).not.toContain(staleSession);
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
});
