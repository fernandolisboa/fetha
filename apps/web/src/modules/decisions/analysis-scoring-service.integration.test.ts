import Decimal from "decimal.js";
import { eq, inArray, max } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  confidenceSchema,
  decimalStringSchema,
  tickerSchema,
  type AnalysisOutputV2,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { candles, tradingSessions } from "@/modules/market-data/schema";

import { AnalysesRepository } from "./analyses-repository";
import { resolveOutlookHorizon } from "./analysis-horizon";
import { AnalysisScoresRepository } from "./analysis-scores-repository";
import { scoreDueAnalyses } from "./analysis-scoring-service";
import { analysisScores } from "./schema";

function uniqueEmail(label: string): string {
  return `fetha-analysis-scoring-${label}-${crypto.randomUUID()}@example.com`;
}

const createdTickers: Ticker[] = [];

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  const ticker = tickerSchema.parse(`AS${suffix}`);
  createdTickers.push(ticker);
  return ticker;
}

function sessionOffset(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function insertBareUser(email: string): Promise<{ id: string }> {
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
    .returning({ id: user.id });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
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

async function insertCandle(ticker: Ticker, session: string, close: string): Promise<void> {
  const value = new Decimal(close);
  const row = cotahistStockRowSchema.parse({
    kind: "stock",
    session,
    ticker,
    open: value.toFixed(6),
    high: value.times("1.02").toFixed(6),
    low: value.times("0.98").toFixed(6),
    average: value.toFixed(6),
    close,
    trades: 100,
    tradedQuantity: 5000,
  });
  const [calendarRow] = await getDb()
    .select({ close: tradingSessions.close })
    .from(tradingSessions)
    .where(eq(tradingSessions.date, session));
  if (!calendarRow) {
    throw new Error(`missing trading session ${session}`);
  }
  await upsertDailyCandles(getDb(), session, calendarRow.close, [row]);
}

const OUTPUT: AnalysisOutputV2 = {
  thesis: "thesis",
  counterThesis: "counter-thesis",
  keyRisks: ["risk"],
  maxLoss: "max loss",
  breakEvens: "break-evens",
  invalidation: ["condition"],
  confidence: { level: "medium", justification: "justification" },
  inputsCited: ["underlying"],
  outlook: {
    instrumentFact: "underlying",
    direction: "above",
    levelFact: "pricing.spot",
    horizon: "one_week",
    likelihood: "likely",
  },
};

async function acceptedAnalysisWithClaim(
  owner: { id: string },
  ticker: Ticker,
  level: string,
  horizon: string,
): Promise<string> {
  const repository = new AnalysesRepository(getDb(), owner);
  const { id } = await repository.reserve({
    subjectKind: "held_operation",
    subjectId: crypto.randomUUID(),
    inputs: { subject: "held_operation", facts: { underlying: ticker } },
    promptVersion: "analysis@2",
    model: "claude-opus-5-5",
  });
  await repository.complete(id, {
    outcome: "accepted",
    output: OUTPUT,
    reason: null,
    model: "claude-opus-5-5",
    inputTokens: 10,
    outputTokens: 20,
    claim: {
      claim: { kind: "close_above", instrument: ticker, level: decimalStringSchema.parse(level) },
      confidence: confidenceSchema.parse("0.75"),
      horizon,
    },
  });
  return id;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  const tickers = createdTickers.splice(0);
  if (tickers.length > 0) {
    await db.delete(candles).where(inArray(candles.ticker, tickers));
  }
});

// The real engine, as `scoring-service.integration.test.ts` uses for
// decisions (docs/adr/0058).
describe("scoreDueAnalyses with the real engine", () => {
  it("scores each due outlook on the horizon close, once, and leaves later ones pending", async () => {
    const db = getDb();
    const email = uniqueEmail("real-engine");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const today = new Date().toISOString().slice(0, 10);
    const anchor = sessionOffset(today, -1);
    const horizon = sessionOffset(anchor, 5);
    const later = sessionOffset(anchor, 30);
    await insertSession(anchor);
    await insertSession(horizon);
    await insertSession(later);
    await insertCandle(ticker, horizon, "45.000000");

    const held = await acceptedAnalysisWithClaim(owner, ticker, "40", horizon);
    const failed = await acceptedAnalysisWithClaim(owner, ticker, "50", horizon);
    const pending = await acceptedAnalysisWithClaim(owner, ticker, "40", later);

    const outcome = await scoreDueAnalyses(db, { okSessions: [horizon] });
    expect(outcome.errors).toEqual([]);
    expect(outcome.analysesScored).toBe(2);

    const scores = await new AnalysisScoresRepository(db, owner).findForRequests([
      held,
      failed,
      pending,
    ]);
    expect(scores.get(held)).toMatchObject({ claimHeld: true, unscorableReason: null });
    expect(new Decimal(scores.get(held)?.brier ?? "NaN").equals("0.0625")).toBe(true);
    expect(scores.get(failed)).toMatchObject({ claimHeld: false });
    expect(new Decimal(scores.get(failed)?.brier ?? "NaN").equals("0.5625")).toBe(true);
    expect(scores.has(pending)).toBe(false);

    const [stored] = await db
      .select({ score: analysisScores.score })
      .from(analysisScores)
      .where(eq(analysisScores.requestId, held));
    expect(stored?.score?.notes).toContainEqual(expect.objectContaining({ code: "no_operation" }));

    const rerun = await scoreDueAnalyses(db, { okSessions: [horizon] });
    expect(rerun.analysesScored).toBe(0);
  });

  it("retries missing data, then records it as unscorable five sessions after the horizon", async () => {
    const db = getDb();
    const email = uniqueEmail("insufficient");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const ticker = randomTicker();

    const today = new Date().toISOString().slice(0, 10);
    const anchor = sessionOffset(today, -1);
    const horizon = sessionOffset(anchor, 3);
    const sessionsAfter = [1, 2, 3, 4, 5].map((days) => sessionOffset(horizon, days));
    for (const session of [anchor, horizon, ...sessionsAfter]) {
      await insertSession(session);
    }
    const request = await acceptedAnalysisWithClaim(owner, ticker, "40", horizon);
    const repository = new AnalysisScoresRepository(db, owner);

    const early = await scoreDueAnalyses(db, { okSessions: [horizon] });
    expect(early.analysesSkipped).toBe(1);
    expect((await repository.findForRequests([request])).size).toBe(0);

    await scoreDueAnalyses(db, { okSessions: [sessionsAfter.at(-1) ?? horizon] });
    expect((await repository.findForRequests([request])).get(request)).toMatchObject({
      unscorableReason: "insufficient_data",
      claimHeld: null,
    });
  });
});

describe("resolveOutlookHorizon", () => {
  it("counts sessions after the latest closed one, and finds the expiry session", async () => {
    const db = getDb();
    // Other integration files leave far-future sessions behind, so the
    // synthetic calendar starts after the latest one: counting sessions
    // forward must see only these.
    const [latest] = await db.select({ date: max(tradingSessions.date) }).from(tradingSessions);
    const base = sessionOffset(latest?.date ?? "2091-03-05", 30);
    const sessions = [0, 1, 2, 5, 6, 7, 8, 9].map((days) => sessionOffset(base, days));
    for (const session of sessions) {
      await insertSession(session);
    }
    const duringSecondSession = new Date(`${sessionOffset(base, 1)}T15:00:00.000Z`);

    expect(
      await resolveOutlookHorizon(db, { kind: "sessions", count: 5 }, duringSecondSession),
    ).toBe(sessionOffset(base, 7));
    expect(
      await resolveOutlookHorizon(
        db,
        { kind: "expiry", expiry: sessionOffset(base, 3) },
        duringSecondSession,
      ),
    ).toBe(sessionOffset(base, 5));
    expect(
      await resolveOutlookHorizon(db, { kind: "sessions", count: 63 }, duringSecondSession),
    ).toBeNull();
    expect(
      await resolveOutlookHorizon(
        db,
        { kind: "expiry", expiry: sessionOffset(base, 1) },
        new Date(`${sessionOffset(base, 1)}T22:00:00.000Z`),
      ),
    ).toBeNull();

    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  });
});
