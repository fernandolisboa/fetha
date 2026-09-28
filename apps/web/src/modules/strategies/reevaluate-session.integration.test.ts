import Decimal from "decimal.js";
import { eq, sql } from "drizzle-orm";
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
import { user } from "@/modules/auth/schema";
import { candles, tradingSessions } from "@/modules/market-data/schema";
import { deleteTestUser } from "@/db/test/cleanup";
import { loadMarketView, MarketViewUnavailableError } from "@/modules/market-data";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { RiskProfileRepository } from "@/modules/portfolio";
import { WatchlistRepository } from "@/modules/watchlist";

import { evaluateSignalsForSession } from "./evaluate-signals";
import { INBOX_ENTRY_SESSION_HORIZON } from "./evaluate-version";
import { reevaluateSession, ReevaluationTargetNotFoundError } from "./reevaluate-session";
import { evaluations, signalReevaluations, signals } from "./schema";
import { ReevaluationConflictError, SignalsRepository } from "./signals-repository";
import { StrategiesRepository, StrategyNotFoundError } from "./strategies-repository";

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
  return `fetha-reevaluate-session-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`RV${suffix}`);
}

// Years 2045-2049 (2040-2044 belong to evaluate-signals): deliberately disjoint from every other integration
// fixture's own "far future" literal (2031 in partitions.integration.test.ts
// and signals-repository.integration.test.ts, 2098-2099 in
// market-view.integration.test.ts and option-repository.integration.test.ts)
// so this file's random draws can never create or touch a monthly partition
// another test's own precondition assumes doesn't exist yet.
const RANDOM_SESSION_YEAR_BASE = 2045;
const RANDOM_SESSION_YEAR_SPAN = 5;

function randomSession(): string {
  const year = RANDOM_SESSION_YEAR_BASE + Math.floor(Math.random() * RANDOM_SESSION_YEAR_SPAN);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 27);
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// `count` consecutive calendar days from a random anchor, oldest first: the
// nightly evaluation's `since`/`at` catch-up range doesn't require a real B3
// trading calendar, just a distinct sequence of `date` rows.
function randomSessionSequence(count: number): string[] {
  const year = RANDOM_SESSION_YEAR_BASE + Math.floor(Math.random() * RANDOM_SESSION_YEAR_SPAN);
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

// The wall clock of the nightly run after `session`: the inbox horizon counts
// sessions back from it (docs/adr/0044), and these fixtures live in the
// 2040s.
function nightAfter(session: string): () => number {
  return () => Date.parse(`${session}T23:30:00.000Z`);
}

// `high`/`low`/`open`/`average` all derived from `close`:
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
  // Restores the pass-through default (the `loadMarketView`
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

function closeAboveDefinition(threshold: string): StrategyDefinition {
  return {
    ...alwaysFiringDefinition(),
    name: "Fecha acima",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString(threshold) },
    },
  };
}

interface Fixture {
  owner: { id: string; name: string; email: string };
  strategyId: string;
  ticker: Ticker;
  session: string;
  now: () => number;
}

// One user, one active strategy, one watched ticker, one session the nightly
// run already evaluated.
async function evaluatedSession(
  label: string,
  definition: StrategyDefinition,
  close = "10.750000",
): Promise<Fixture> {
  const db = getDb();
  const session = randomSession();
  createdSessions.push(session);
  const ticker = randomTicker();
  createdTickers.push(ticker);
  const email = uniqueEmail(label);
  createdEmails.push(email);
  const owner = await insertBareUser(email);

  await insertSession(session);
  await insertCandle(ticker, session, close);
  await declareRiskProfile(owner);
  await new WatchlistRepository(db, owner).add(ticker);
  const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition);
  await new StrategiesRepository(db, owner).setActive(strategy.id, true);

  const now = nightAfter(session);
  const night = await evaluateSignalsForSession(db, [session], { now });
  expect(night.errors).toEqual([]);
  return { owner, strategyId: strategy.id, ticker, session, now };
}

async function allRowsOf(owner: { id: string }) {
  const db = getDb();
  return {
    evaluations: await db.select().from(evaluations).where(eq(evaluations.userId, owner.id)),
    signals: await db.select().from(signals).where(eq(signals.userId, owner.id)),
    audit: await db
      .select()
      .from(signalReevaluations)
      .where(eq(signalReevaluations.userId, owner.id)),
  };
}

describe("reevaluateSession (#84, docs/adr/0045)", () => {
  it("replaces a signal whose proposal a corrected candle changed, keeping the old row and resetting read state", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("replace", alwaysFiringDefinition());
    const repository = new SignalsRepository(db, fixture.owner);
    const [before] = await repository.listInbox();
    if (!before) throw new Error("fixture produced no signal");
    await repository.markRead(before.id);

    await insertCandle(fixture.ticker, fixture.session, "12.000000");
    const outcome = await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });

    expect(outcome).toEqual({
      status: "applied",
      counts: {
        evaluationsSuperseded: 0,
        signalsRetracted: 0,
        signalsReplaced: 1,
        signalsAdded: 0,
      },
    });
    const inbox = await repository.listInbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.id).not.toBe(before.id);
    expect(inbox[0]?.readAt).toBeNull();
    expect(inbox[0]?.proposal).not.toEqual(before.proposal);

    const rows = await allRowsOf(fixture.owner);
    expect(rows.signals).toHaveLength(2);
    const old = rows.signals.find((row) => row.id === before.id);
    expect(old?.supersededBy).toBe(rows.audit[0]?.id);
    expect(old?.readAt).not.toBeNull();
    expect(rows.audit).toEqual([
      expect.objectContaining({ session: fixture.session, status: "applied", signalsReplaced: 1 }),
    ]);
    expect(await repository.listEvaluationLog()).toEqual([
      expect.objectContaining({ session: fixture.session, reevaluated: true }),
    ]);
  });

  it("changes nothing and keeps the same signal, read state included, when the data did not change", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("unchanged", alwaysFiringDefinition());
    const repository = new SignalsRepository(db, fixture.owner);
    const [before] = await repository.listInbox();
    if (!before) throw new Error("fixture produced no signal");
    await repository.markRead(before.id);

    const outcome = await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });

    expect(outcome).toEqual({ status: "unchanged" });
    const [after] = await repository.listInbox();
    expect(after?.id).toBe(before.id);
    expect(after?.readAt).not.toBeNull();
    const rows = await allRowsOf(fixture.owner);
    expect(rows.signals).toHaveLength(1);
    expect(rows.evaluations).toHaveLength(1);
    expect(rows.audit).toEqual([expect.objectContaining({ status: "unchanged" })]);
  });

  it("retracts a signal the corrected data no longer supports and supersedes its evaluation", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("retract", closeAboveDefinition("11"), "12.000000");
    const repository = new SignalsRepository(db, fixture.owner);
    expect(await repository.listInbox()).toHaveLength(1);

    await insertCandle(fixture.ticker, fixture.session, "10.000000");
    const outcome = await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });

    expect(outcome).toEqual({
      status: "applied",
      counts: {
        evaluationsSuperseded: 1,
        signalsRetracted: 1,
        signalsReplaced: 0,
        signalsAdded: 0,
      },
    });
    expect(await repository.listInbox()).toEqual([]);
    expect(await repository.unreadCount()).toBe(0);
    const log = await repository.listEvaluationLog();
    expect(log).toEqual([
      expect.objectContaining({ outcome: "conditions_not_met", reevaluated: true }),
    ]);
    const rows = await allRowsOf(fixture.owner);
    expect(rows.evaluations).toHaveLength(2);
    expect(rows.signals).toHaveLength(1);
    expect(rows.signals[0]?.supersededBy).not.toBeNull();
  });

  it("adds a signal the corrected data now supports", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("add", closeAboveDefinition("11"), "10.000000");
    const repository = new SignalsRepository(db, fixture.owner);
    expect(await repository.listInbox()).toEqual([]);

    await insertCandle(fixture.ticker, fixture.session, "12.000000");
    const outcome = await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });

    expect(outcome).toEqual({
      status: "applied",
      counts: {
        evaluationsSuperseded: 1,
        signalsRetracted: 0,
        signalsReplaced: 0,
        signalsAdded: 1,
      },
    });
    expect(await repository.listInbox()).toHaveLength(1);
  });

  it("records a failed recomputation and leaves every signal and evaluation untouched", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("failed", alwaysFiringDefinition());
    const before = await allRowsOf(fixture.owner);

    loadMarketViewMock.mockImplementationOnce(() => {
      throw new MarketViewUnavailableError("simulated outage");
    });
    const outcome = await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });

    expect(outcome).toEqual({ status: "failed", reason: "no_market_data" });
    const after = await allRowsOf(fixture.owner);
    expect(after.signals).toEqual(before.signals);
    expect(after.evaluations).toEqual(before.evaluations);
    expect(after.audit).toEqual([
      expect.objectContaining({ status: "failed", failureReason: "no_market_data" }),
    ]);
  });

  it("does not retract an unchanged signal just because its session is past the inbox horizon", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("aged", alwaysFiringDefinition());
    const later = randomSessionSequence(INBOX_ENTRY_SESSION_HORIZON + 1).map((date) =>
      date.replace(/^\d{4}/, String(Number(fixture.session.slice(0, 4)) + 1)),
    );
    for (const date of later) {
      createdSessions.push(date);
      await insertSession(date);
    }
    const lastLater = later[later.length - 1];
    if (!lastLater) throw new Error("fixture setup failed");

    const outcome = await reevaluateSession(db, fixture.owner, fixture, {
      now: nightAfter(lastLater),
    });

    expect(outcome).toEqual({ status: "unchanged" });
    expect(await new SignalsRepository(db, fixture.owner).listInbox()).toHaveLength(1);
  });

  it("retracts a changed entry past the inbox horizon instead of writing a stale proposal", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("aged-changed", alwaysFiringDefinition());
    const later = randomSessionSequence(INBOX_ENTRY_SESSION_HORIZON + 1).map((date) =>
      date.replace(/^\d{4}/, String(Number(fixture.session.slice(0, 4)) + 1)),
    );
    for (const date of later) {
      createdSessions.push(date);
      await insertSession(date);
    }
    const lastLater = later[later.length - 1];
    if (!lastLater) throw new Error("fixture setup failed");

    await insertCandle(fixture.ticker, fixture.session, "12.000000");
    const outcome = await reevaluateSession(db, fixture.owner, fixture, {
      now: nightAfter(lastLater),
    });

    expect(outcome).toEqual({
      status: "applied",
      counts: {
        evaluationsSuperseded: 1,
        signalsRetracted: 1,
        signalsReplaced: 0,
        signalsAdded: 0,
      },
    });
    const repository = new SignalsRepository(db, fixture.owner);
    expect(await repository.listInbox()).toEqual([]);
    const log = await repository.listEvaluationLog();
    expect(log).toEqual([
      expect.objectContaining({
        outcome: "signal",
        reason: "entry_past_inbox_horizon",
        detail: String(INBOX_ENTRY_SESSION_HORIZON),
        reevaluated: true,
      }),
    ]);
  });

  it("refuses a session this strategy was never evaluated on", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("never", alwaysFiringDefinition());
    const other = randomSession();
    createdSessions.push(other);
    await insertSession(other);

    await expect(
      reevaluateSession(db, fixture.owner, { strategyId: fixture.strategyId, session: other }),
    ).rejects.toBeInstanceOf(ReevaluationTargetNotFoundError);
  });

  it("isolation: user B cannot re-evaluate, read or touch user A's signals", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("isolation-a", alwaysFiringDefinition());
    const emailB = uniqueEmail("isolation-b");
    createdEmails.push(emailB);
    const userB = await insertBareUser(emailB);
    const before = await allRowsOf(fixture.owner);

    await expect(reevaluateSession(db, userB, fixture)).rejects.toBeInstanceOf(
      StrategyNotFoundError,
    );
    expect(
      await new SignalsRepository(db, userB).reevaluationTargets(
        fixture.strategyId,
        fixture.session,
      ),
    ).toEqual({ evaluations: [], signals: [] });

    const after = await allRowsOf(fixture.owner);
    expect(after).toEqual(before);
    expect((await allRowsOf(userB)).audit).toEqual([]);
  });
});

describe("reevaluateSession edge cases (#84, docs/adr/0045)", () => {
  it("rolls back and audits the attempt as a conflict when another run superseded a target first", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("conflict", alwaysFiringDefinition());
    const [current] = await new SignalsRepository(db, fixture.owner).listInbox();
    if (!current) throw new Error("fixture produced no signal");
    await insertCandle(fixture.ticker, fixture.session, "12.000000");

    // The concurrent winner commits after this run read its targets and
    // before it writes: the recomputation's own market-data load sits
    // exactly in that gap.
    loadMarketViewMock.mockImplementationOnce(async (...args) => {
      const [winner] = await db
        .insert(signalReevaluations)
        .values({
          userId: fixture.owner.id,
          strategyId: fixture.strategyId,
          session: fixture.session,
          status: "applied",
        })
        .returning({ id: signalReevaluations.id });
      if (!winner) throw new Error("failed to insert the concurrent winner");
      await db.update(signals).set({ supersededBy: winner.id }).where(eq(signals.id, current.id));
      return realLoadMarketView(...args);
    });
    await expect(
      reevaluateSession(db, fixture.owner, fixture, { now: fixture.now }),
    ).rejects.toBeInstanceOf(ReevaluationConflictError);

    const rows = await allRowsOf(fixture.owner);
    expect(rows.signals).toHaveLength(1);
    expect(rows.evaluations).toHaveLength(1);
    expect(rows.audit.map((row) => [row.status, row.failureReason]).sort()).toEqual([
      ["applied", null],
      ["failed", "conflict"],
    ]);
  });

  it("never targets a session only the catch-up clamp logged", async () => {
    const db = getDb();
    const email = uniqueEmail("clamped");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const session = randomSession();
    createdSessions.push(session);
    await insertSession(session);
    const strategy = await new StrategiesRepository(db, owner).createWithVersion(
      alwaysFiringDefinition(),
    );
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");
    await db.insert(evaluations).values({
      userId: owner.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      ticker: randomTicker(),
      session,
      at: new Date(`${session}T21:00:00.000Z`),
      outcome: "insufficient_data",
      reason: "catchup_clamped",
      detail: "8",
    });

    await expect(
      reevaluateSession(db, owner, { strategyId: strategy.id, session }),
    ).rejects.toBeInstanceOf(ReevaluationTargetNotFoundError);
    expect((await allRowsOf(owner)).audit).toEqual([]);
  });
});

describe("append-only signals and evaluations (migration 0027)", () => {
  it("refuses to rewrite an evaluation or a signal, and to supersede one twice", async () => {
    const db = getDb();
    const fixture = await evaluatedSession("append-only", alwaysFiringDefinition());
    const rows = await allRowsOf(fixture.owner);
    const evaluation = rows.evaluations[0];
    const signal = rows.signals[0];
    if (!evaluation || !signal) throw new Error("fixture produced no rows");

    await expect(
      db.execute(sql`update evaluations set outcome = 'unsizeable' where id = ${evaluation.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`update signals set proposal = null where id = ${signal.id}`),
    ).rejects.toThrow();

    await insertCandle(fixture.ticker, fixture.session, "12.000000");
    await reevaluateSession(db, fixture.owner, fixture, { now: fixture.now });
    await expect(
      db.execute(sql`update signals set superseded_by = null where id = ${signal.id}`),
    ).rejects.toThrow();
  });
});
