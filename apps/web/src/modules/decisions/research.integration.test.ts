import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  centavosSchema,
  confidenceSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type AnalysisInputs,
  type ResearchOutput,
  type Ticker,
} from "@fetha/contracts";
import type { OperationPricing, Score } from "@fetha/engine";

import { getDb } from "@/db/client";
import { assetReadingFixture } from "@/db/test/asset-reading";
import { deleteTestUser } from "@/db/test/cleanup";
import { DEFAULT_COST_MODEL } from "@/modules/backtests";
import { user } from "@/modules/auth/schema";
import {
  candles,
  companyFilings,
  companyTickers,
  tradingSessions,
} from "@/modules/market-data/schema";
import { filingLabels } from "@/modules/sentiment/schema";
import { recordFinalFilingLabel } from "@/modules/sentiment/repositories/filing-label-repository";
import type { Idea } from "@/modules/radar";

import { AnalysesRepository, MONTHLY_ANALYSIS_CAP } from "./analyses-repository";
import type { AnalysisModelClient } from "./analysis-model";
import { DecisionsRepository, DuplicateSignalDecisionError } from "./decisions-repository";
import { researchCalibration } from "./research-calibration";
import { storeSeededResearch, type SeedE2EResearchIdea } from "./research-e2e-seed";
import { ResearchRepository } from "./research-repository";
import { ResearchScoresRepository } from "./research-scores-repository";
import { scoreDueResearch } from "./research-scoring-service";
import { assembleResearchInputs } from "./research-inputs";
import { requestResearch } from "./research-service";
import {
  analysisRequests,
  analysisResults,
  decisions,
  researchIdeas,
  researchIdeaScores,
  suggestionResearches,
} from "./schema";

const createdEmails: string[] = [];
const createdTickers: Ticker[] = [];
const createdSessions: string[] = [];
const createdCnpjs: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) await deleteTestUser(db, email);
  const tickers = createdTickers.splice(0);
  if (tickers.length > 0) await db.delete(candles).where(inArray(candles.ticker, tickers));
  for (const cnpj of createdCnpjs.splice(0)) {
    const protocols = (
      await db
        .select({ protocol: companyFilings.protocol })
        .from(companyFilings)
        .where(eq(companyFilings.cnpj, cnpj))
    ).map((row) => row.protocol);
    if (protocols.length > 0) {
      await db.delete(filingLabels).where(inArray(filingLabels.protocol, protocols));
    }
    await db.delete(companyFilings).where(eq(companyFilings.cnpj, cnpj));
    await db.delete(companyTickers).where(eq(companyTickers.cnpj, cnpj));
  }
  const sessions = createdSessions.splice(0);
  if (sessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, sessions));
  }
});

async function insertBareUser(label: string): Promise<{ id: string }> {
  const email = `fetha-research-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({ id: user.id });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  const ticker = tickerSchema.parse(`RS${suffix}`);
  createdTickers.push(ticker);
  return ticker;
}

function sessionOffset(base: string, days: number): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  createdSessions.push(session);
}

const NEWEST_CLOSE = sessionDateSchema.parse("2026-10-23");
const EXPIRY = sessionDateSchema.parse("2026-11-20");

const pricing = {
  at: "2026-10-23T21:00:00.000Z",
  underlying: "PETR4",
  spot: "38.50",
  legs: [],
  netPremium: -12000,
  breakEvens: ["39.70"],
  payoff: [
    { underlying: "36.00", pnl: -12000 },
    { underlying: "42.00", pnl: 8000 },
  ],
  maxLoss: 12000,
  maxGain: 8000,
} as unknown as OperationPricing;

function ideaOf(ticker: string, expiry = EXPIRY): Idea {
  return {
    underlying: tickerSchema.parse(ticker),
    recipeId: "bull-call-spread-low-iv",
    structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
    foundOn: sessionDateSchema.parse("2026-10-21"),
    expiry,
    sessionsToExpiry: 20,
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: tickerSchema.parse(`${ticker.slice(0, 4)}K385`),
        strike: decimalStringSchema.parse("38.5"),
        expiry,
        quantity: quantitySchema.parse(100),
        price: decimalStringSchema.parse("1.20"),
      },
    ],
    netPremium: centavosSchema.parse(-12000),
    maxLoss: centavosSchema.parse(12000),
    maxGain: centavosSchema.parse(8000),
    breakEvens: [decimalStringSchema.parse("39.70")],
    reading: assetReadingFixture(ticker),
    alerts: [],
    suggestionId: null,
    pricing,
  };
}

const FACTS: AnalysisInputs = {
  subject: "research",
  facts: {
    newestClose: "23/10/2026",
    ideas: [
      { underlying: "PETR4", pricing: { maxLoss: "R$ 120,00" } },
      { underlying: "VALE3", pricing: { maxLoss: "R$ 120,00" } },
    ],
  },
};

const answer = (position: number, verdict: ResearchOutput["ideas"][number]["verdict"]) => ({
  idea: `ideas.${String(position)}`,
  verdict,
  justification: "A perda máxima é de R$ 120,00.",
  alerts: [],
  inputsCited: [`ideas.${String(position)}.pricing.maxLoss`],
});

function clientReplying(output: unknown): { analyze: Mock } {
  return {
    analyze: vi.fn().mockResolvedValue({
      kind: "parsed",
      output,
      model: "claude-opus-5-5",
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  };
}

const good: ResearchOutput = {
  overview: "Duas ideias, ambas com perda máxima de R$ 120,00.",
  ideas: [answer(0, "enter"), answer(1, "do_not_enter")],
};

const researchInput = (ideas: Idea[]) => ({
  newestClose: NEWEST_CLOSE,
  sessionsLooked: 3,
  candidates: 16,
  dropped: { unpriced: 0, expires_too_soon: 1, exceeds_capital: 0, not_evaluable: 2 },
  usingDefaultProfile: true,
  ideas,
});

function depsFor(owner: { id: string }, client: AnalysisModelClient | null) {
  return {
    db: getDb(),
    user: owner,
    client,
    model: "claude-opus-5-5",
    family: "opus" as const,
    assemble: vi.fn().mockResolvedValue({ ok: true, inputs: FACTS }),
  };
}

async function requestsOf(owner: { id: string }) {
  return getDb().select().from(analysisRequests).where(eq(analysisRequests.userId, owner.id));
}

describe("requestResearch against the database (docs/adr/0076)", () => {
  it("stores an accepted research with its ideas, claims and horizons next to the result row", async () => {
    const owner = await insertBareUser("accepted");
    const result = await requestResearch(
      depsFor(owner, clientReplying(good)),
      researchInput([ideaOf("PETR4"), ideaOf("VALE3")]),
    );
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") return;

    const stored = await new ResearchRepository(getDb(), owner).find(result.researchId);
    expect(stored).toMatchObject({
      newestClose: NEWEST_CLOSE,
      sessionsLooked: 3,
      candidates: 16,
      usingDefaultProfile: true,
      model: "claude-opus-5-5",
      overview: good.overview,
    });
    expect(stored?.dropped).toEqual({
      unpriced: 0,
      expires_too_soon: 1,
      exceeds_capital: 0,
      not_evaluable: 2,
    });
    expect(stored?.ideas.map((idea) => [idea.position, idea.underlying, idea.verdict])).toEqual([
      [0, "PETR4", "enter"],
      [1, "VALE3", "do_not_enter"],
    ]);
    expect(stored?.ideas[0]).toMatchObject({
      horizon: EXPIRY,
      newestClose: NEWEST_CLOSE,
      claim: { kind: "close_above", instrument: "PETR4", level: "39.70" },
      justification: "A perda máxima é de R$ 120,00.",
      inputsCited: ["ideas.0.pricing.maxLoss"],
      pricing: { maxLoss: 12000 },
    });

    const requests = await requestsOf(owner);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ subjectKind: "research", promptVersion: "research@1" });
    const results = await getDb()
      .select()
      .from(analysisResults)
      .where(eq(analysisResults.userId, owner.id));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: "accepted", claim: null, horizon: null });
    expect(await new AnalysesRepository(getDb(), owner).usageThisMonth()).toMatchObject({
      used: 1,
    });
    expect((await new ResearchRepository(getDb(), owner).latest())?.id).toBe(result.researchId);
  });

  it("keeps a research out of the journal's analyses", async () => {
    const owner = await insertBareUser("journal");
    await requestResearch(
      depsFor(owner, clientReplying(good)),
      researchInput([ideaOf("PETR4"), ideaOf("VALE3")]),
    );
    expect(await new AnalysesRepository(getDb(), owner).listAcceptedForJournal()).toEqual([]);
  });

  it("stores only the result row for a rejected reply, and it still counts toward the cap", async () => {
    const owner = await insertBareUser("rejected");
    const result = await requestResearch(
      depsFor(owner, clientReplying({ ...good, ideas: [answer(0, "enter")] })),
      researchInput([ideaOf("PETR4"), ideaOf("VALE3")]),
    );
    expect(result).toEqual({ status: "rejected" });

    const results = await getDb()
      .select()
      .from(analysisResults)
      .where(eq(analysisResults.userId, owner.id));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      outcome: "rejected",
      output: null,
      reason: { kind: "research_ideas", problem: "missing" },
    });
    expect(
      await getDb()
        .select()
        .from(suggestionResearches)
        .where(eq(suggestionResearches.userId, owner.id)),
    ).toEqual([]);
    expect(
      await getDb().select().from(researchIdeas).where(eq(researchIdeas.userId, owner.id)),
    ).toEqual([]);
    expect(await new AnalysesRepository(getDb(), owner).usageThisMonth()).toMatchObject({
      used: 1,
    });
  });

  it("settles a reply it could not store as rejected, leaving no research behind", async () => {
    const owner = await insertBareUser("storage");
    // An expiry on the close itself breaks the table's `horizon > newest_close` check.
    const result = await requestResearch(
      depsFor(owner, clientReplying(good)),
      researchInput([ideaOf("PETR4", NEWEST_CLOSE), ideaOf("VALE3")]),
    );
    expect(result).toEqual({ status: "rejected" });
    const results = await getDb()
      .select()
      .from(analysisResults)
      .where(eq(analysisResults.userId, owner.id));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ outcome: "rejected", reason: { kind: "storage" } });
    expect(
      await getDb()
        .select()
        .from(suggestionResearches)
        .where(eq(suggestionResearches.userId, owner.id)),
    ).toEqual([]);
    expect(await new AnalysesRepository(getDb(), owner).usageThisMonth()).toMatchObject({
      used: 1,
    });
  });

  it("reserves nothing and calls no model without a client or without ideas", async () => {
    const owner = await insertBareUser("nothing");
    const client = clientReplying(good);
    expect(await requestResearch(depsFor(owner, null), researchInput([ideaOf("PETR4")]))).toEqual({
      status: "unavailable",
    });
    expect(await requestResearch(depsFor(owner, client), researchInput([]))).toEqual({
      status: "not_ready",
    });
    expect(client.analyze).not.toHaveBeenCalled();
    expect(await requestsOf(owner)).toEqual([]);
  });

  it("stops at the monthly cap before calling the model", async () => {
    const owner = await insertBareUser("cap");
    const repository = new AnalysesRepository(getDb(), owner);
    for (let used = 0; used < MONTHLY_ANALYSIS_CAP; used += 1) {
      await repository.reserve({
        subjectKind: "research",
        subjectId: crypto.randomUUID(),
        inputs: FACTS,
        promptVersion: "research@1",
        model: "claude-opus-5-5",
      });
    }
    const client = clientReplying(good);
    expect(await requestResearch(depsFor(owner, client), researchInput([ideaOf("PETR4")]))).toEqual(
      { status: "cap_reached" },
    );
    expect(client.analyze).not.toHaveBeenCalled();
    expect(await requestsOf(owner)).toHaveLength(MONTHLY_ANALYSIS_CAP);
  });
});

const immutable: unknown = expect.stringMatching(/immutable/);

function seededIdea(ticker: string, overrides: Partial<SeedE2EResearchIdea> = {}) {
  return {
    underlying: ticker,
    recipeId: "bull-call-spread-low-iv",
    foundOn: sessionDateSchema.parse("2026-10-21"),
    suggestionId: null,
    sessionsToExpiry: 20,
    legs: ideaOf(ticker).legs,
    pricing,
    reading: assetReadingFixture(ticker),
    engineAlerts: [],
    verdict: "enter" as const,
    justification: "Justificativa",
    aiAlerts: [],
    claim: { kind: "operation_pnl_positive" as const },
    horizon: EXPIRY,
    ...overrides,
  } satisfies SeedE2EResearchIdea;
}

async function seedResearchFor(
  owner: { id: string },
  ideas: SeedE2EResearchIdea[],
  newestClose = NEWEST_CLOSE,
): Promise<{ researchId: string; ideaIds: string[] }> {
  const researchId = await storeSeededResearch(getDb(), owner, {
    research: {
      newestClose,
      sessionsLooked: 3,
      candidates: ideas.length,
      dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
      usingDefaultProfile: true,
    },
    model: "claude-opus-5-5",
    overview: "Visão geral",
    ideas,
  });
  const ideaIds = await new ResearchRepository(getDb(), owner).ideaIdsOf(researchId);
  return { researchId, ideaIds };
}

describe("tenant isolation of researches, ideas, scores and decisions on them", () => {
  it("shows user B none of user A's research, and refuses B's writes against it", async () => {
    const db = getDb();
    const userA = await insertBareUser("iso-a");
    const userB = await insertBareUser("iso-b");
    const { researchId, ideaIds } = await seedResearchFor(userA, [seededIdea("PETR4")]);
    const [ideaId] = ideaIds;
    if (!ideaId) throw new Error("seed stored no idea");

    const readsB = new ResearchRepository(db, userB);
    expect(await readsB.latest()).toBeNull();
    expect(await readsB.find(researchId)).toBeNull();
    expect(await readsB.findIdea(ideaId)).toBeNull();
    expect(await readsB.ideaIdsOf(researchId)).toEqual([]);
    expect((await new ResearchRepository(db, userA).find(researchId))?.ideas).toHaveLength(1);

    const scoresB = new ResearchScoresRepository(db, userB);
    expect(await scoresB.allMine()).toEqual([]);
    expect(await scoresB.dueForUser("2099-01-01")).toEqual({ due: [], invalid: [] });
    expect(await scoresB.findForIdeas([ideaId])).toEqual(new Map());

    await expect(
      db.insert(researchIdeas).values({
        researchId,
        userId: userB.id,
        position: 5,
        underlying: "PETR4",
        recipeId: "x",
        foundOn: "2026-10-21",
        newestClose: "2026-10-23",
        sessionsToExpiry: 5,
        legs: [],
        pricing: {} as never,
        reading: {} as never,
        engineAlerts: [],
        verdict: "enter",
        justification: "x",
        aiAlerts: [],
        inputsCited: [],
        claim: { kind: "operation_pnl_positive" },
        horizon: "2026-11-20",
      }),
    ).rejects.toThrow();
    await expect(
      scoresB.insertIfAbsent({ ideaId, unscorableReason: "x", engineVersion: "test" }),
    ).rejects.toThrow();
    await expect(
      new DecisionsRepository(db, userB).record({
        kind: "enter",
        originKind: "research_idea",
        signalId: null,
        contemplatedOperationId: null,
        researchIdeaId: ideaId,
        strategyVersionId: null,
        inputs: decisionInputs(),
        rationale: "x",
        claim: null,
        confidence: confidenceSchema.parse("0.5"),
        horizon: sessionDateSchema.parse("2099-01-01"),
        costModel: DEFAULT_COST_MODEL,
      }),
    ).rejects.toThrow();
    expect(await db.select().from(decisions).where(eq(decisions.researchIdeaId, ideaId))).toEqual(
      [],
    );
    await expect(
      db.insert(suggestionResearches).values({
        userId: userB.id,
        analysisRequestId: (await requestsOf(userA))[0]?.id ?? "",
        newestClose: "2026-10-23",
        sessionsLooked: 1,
        candidates: 1,
        dropped: {} as never,
        usingDefaultProfile: true,
      }),
    ).rejects.toThrow();
  });

  it("lets a user record one decision per idea, and only on their own", async () => {
    const db = getDb();
    const owner = await insertBareUser("decide");
    const other = await insertBareUser("decide-other");
    const { ideaIds } = await seedResearchFor(owner, [seededIdea("PETR4"), seededIdea("VALE3")]);
    const [first, second] = ideaIds;
    if (!first || !second) throw new Error("seed stored no ideas");

    const repository = new DecisionsRepository(db, owner);
    const record = (researchIdeaId: string, kind: "enter" | "do_not_enter") =>
      repository.record({
        kind,
        originKind: "research_idea",
        signalId: null,
        contemplatedOperationId: null,
        researchIdeaId,
        strategyVersionId: null,
        inputs: decisionInputs(),
        rationale: "Porque sim",
        claim: null,
        confidence: confidenceSchema.parse("0.6"),
        horizon: sessionDateSchema.parse("2099-01-01"),
        costModel: DEFAULT_COST_MODEL,
      });
    await record(first, "enter");
    await expect(record(first, "do_not_enter")).rejects.toBeInstanceOf(
      DuplicateSignalDecisionError,
    );
    await record(second, "do_not_enter");

    const mine = await repository.findForResearchIdeas([first, second]);
    expect(mine.get(first)).toMatchObject({ kind: "enter", researchIdeaId: first });
    expect(mine.get(second)).toMatchObject({ kind: "do_not_enter" });
    expect(await new DecisionsRepository(db, other).findForResearchIdeas([first, second])).toEqual(
      new Map(),
    );
  });

  it("refuses to edit a stored research, its ideas or their scores", async () => {
    const db = getDb();
    const owner = await insertBareUser("append-only");
    const { researchId, ideaIds } = await seedResearchFor(owner, [seededIdea("PETR4")]);
    const [ideaId] = ideaIds;
    if (!ideaId) throw new Error("seed stored no idea");
    await new ResearchScoresRepository(db, owner).insertIfAbsent({
      ideaId,
      unscorableReason: "x",
      engineVersion: "test",
    });

    await expect(
      db
        .update(suggestionResearches)
        .set({ candidates: 99 })
        .where(eq(suggestionResearches.id, researchId)),
    ).rejects.toMatchObject({ cause: { message: immutable } });
    await expect(
      db.update(researchIdeas).set({ verdict: "wait" }).where(eq(researchIdeas.id, ideaId)),
    ).rejects.toMatchObject({ cause: { message: immutable } });
    await expect(
      db
        .update(researchIdeaScores)
        .set({ engineVersion: "other" })
        .where(eq(researchIdeaScores.ideaId, ideaId)),
    ).rejects.toMatchObject({ cause: { message: immutable } });
  });
});

function decisionInputs() {
  return {
    originKind: "research_idea" as const,
    underlying: tickerSchema.parse("PETR4"),
    recipeId: "bull-call-spread-low-iv",
    structureId: "bull-call-spread",
    structureName: "Trava de alta com calls",
    session: NEWEST_CLOSE,
    expiry: EXPIRY,
    legs: [
      {
        role: "call" as const,
        side: "buy" as const,
        ticker: tickerSchema.parse("PETRK385"),
        quantity: quantitySchema.parse(100),
        entryPrice: decimalStringSchema.parse("1.20"),
      },
    ],
    netPremiumCentavos: centavosSchema.parse(-12000),
    maxLossCentavos: centavosSchema.parse(12000),
    maxGainCentavos: centavosSchema.parse(8000),
  };
}

function optionTickerOf(underlying: Ticker): Ticker {
  return tickerSchema.parse(`${underlying.slice(0, 6)}K40`);
}

function lotLegsOf(ticker: Ticker): SeedE2EResearchIdea["legs"] {
  return [
    {
      role: "call",
      side: "buy",
      ticker: optionTickerOf(ticker),
      strike: decimalStringSchema.parse("40"),
      expiry: null,
      quantity: quantitySchema.parse(100),
      price: decimalStringSchema.parse("1.25"),
    },
  ];
}

// The engine's own scoring is covered in its package; here the engine is the test seam
// `scoreDueResearch` offers, so what is under test is which ideas are scored, with what input,
// into whose rows, and when a gap becomes permanent.
const SCORE = {
  pnl: 50000,
  maxLoss: 12500,
  normalizedPnl: "4",
  thesis: { claim: { kind: "operation_pnl_positive" }, held: true },
  notes: [],
  provenance: { engineVersion: "test-engine" },
} as unknown as Score;

function fakeEngine(result: unknown) {
  const score = vi.fn().mockResolvedValue(result);
  return {
    score,
    engine: { score, capabilities: () => ({ engineVersion: "test-engine" }) } as never,
  };
}

describe("scoreDueResearch (docs/adr/0076)", () => {
  async function calendar() {
    const today = new Date().toISOString().slice(0, 10);
    const close = sessionOffset(today, -20);
    const horizon = sessionOffset(close, 5);
    const later = sessionOffset(close, 30);
    for (const session of [close, horizon, later]) await insertSession(session);
    return { close: sessionDateSchema.parse(close), horizon, later };
  }

  function ideaDue(ticker: Ticker, horizon: string, overrides: Partial<SeedE2EResearchIdea> = {}) {
    return seededIdea(ticker, {
      underlying: ticker,
      legs: lotLegsOf(ticker),
      horizon: sessionDateSchema.parse(horizon),
      ...overrides,
    });
  }

  it("scores every verdict, discarded ones included, once, and leaves later horizons pending", async () => {
    const db = getDb();
    const owner = await insertBareUser("scoring");
    const ticker = randomTicker();
    const { close, horizon, later } = await calendar();
    const claim = {
      kind: "close_above" as const,
      instrument: ticker,
      level: decimalStringSchema.parse("42"),
    };
    const { ideaIds } = await seedResearchFor(
      owner,
      [
        ...(["enter", "wait", "do_not_enter"] as const).map((verdict) =>
          ideaDue(ticker, horizon, { verdict, claim }),
        ),
        ideaDue(ticker, later, { claim }),
      ],
      close,
    );
    const { score, engine } = fakeEngine({ ok: true, value: SCORE });

    const outcome = await scoreDueResearch(db, horizon, { engine });
    expect(outcome).toEqual({ asOfSession: horizon, scored: 3, skipped: 0, errors: 0 });

    const scores = await new ResearchScoresRepository(db, owner).findForIdeas(ideaIds);
    expect([...scores.values()].map((row) => row.verdict).sort()).toEqual([
      "do_not_enter",
      "enter",
      "wait",
    ]);
    for (const row of scores.values()) {
      expect(row).toMatchObject({ claimHeld: true, unscorableReason: null, pnlCentavos: 50000 });
    }
    expect(scores.has(ideaIds[3] ?? "")).toBe(false);

    expect(score).toHaveBeenCalledTimes(3);
    const [calendarRow] = await db
      .select({ close: tradingSessions.close })
      .from(tradingSessions)
      .where(eq(tradingSessions.date, close));
    const closeInstant = calendarRow?.close.toISOString();
    const [input] = score.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({
      subject: "enter",
      horizon,
      decidedAt: closeInstant,
      confidence: "1",
      claim,
      realizedFills: [],
      origin: { kind: "manual" },
      costModel: DEFAULT_COST_MODEL,
      operation: {
        underlying: ticker,
        expiry: horizon,
        openedAt: close,
        strategyVersionId: null,
        legs: [
          {
            role: "call",
            side: "buy",
            ticker: optionTickerOf(ticker),
            quantity: 100,
            entryPrice: "1.25",
          },
        ],
      },
    });

    expect(await scoreDueResearch(db, horizon, { engine })).toMatchObject({ scored: 0 });
    expect(score).toHaveBeenCalledTimes(3);
    const stored = await db
      .select()
      .from(researchIdeaScores)
      .where(eq(researchIdeaScores.userId, owner.id));
    expect(stored).toHaveLength(3);
    expect(stored[0]).toMatchObject({ engineVersion: "test-engine", normalizedPnl: "4" });

    const lines = researchCalibration([...scores.values()]);
    expect(lines.map((line) => [line.verdict, line.scored, line.held, line.averagePnl])).toEqual([
      ["enter", 1, 1, 50000],
      ["wait", 1, 1, 50000],
      ["do_not_enter", 1, 1, 50000],
    ]);
  });

  it("scores each user's ideas into their own rows", async () => {
    const db = getDb();
    const userA = await insertBareUser("scoring-a");
    const userB = await insertBareUser("scoring-b");
    const ticker = randomTicker();
    const { close, horizon } = await calendar();
    await seedResearchFor(userA, [ideaDue(ticker, horizon)], close);
    await seedResearchFor(userB, [ideaDue(ticker, horizon)], close);

    await scoreDueResearch(db, horizon, { engine: fakeEngine({ ok: true, value: SCORE }).engine });

    expect(await new ResearchScoresRepository(db, userA).allMine()).toHaveLength(1);
    expect(await new ResearchScoresRepository(db, userB).allMine()).toHaveLength(1);
    const rows = await db
      .select({ userId: researchIdeaScores.userId, ideaUser: researchIdeas.userId })
      .from(researchIdeaScores)
      .innerJoin(researchIdeas, eq(researchIdeas.id, researchIdeaScores.ideaId))
      .where(inArray(researchIdeaScores.userId, [userA.id, userB.id]));
    expect(rows.every((row) => row.userId === row.ideaUser)).toBe(true);
  });

  it("retries missing data, then records it as unscorable five sessions after the horizon", async () => {
    const db = getDb();
    const owner = await insertBareUser("insufficient");
    const ticker = randomTicker();
    const today = new Date().toISOString().slice(0, 10);
    const close = sessionOffset(today, -30);
    const horizon = sessionOffset(close, 3);
    const after = [1, 2, 3, 4, 5].map((days) => sessionOffset(horizon, days));
    for (const session of [close, horizon, ...after]) await insertSession(session);
    const { ideaIds } = await seedResearchFor(
      owner,
      [ideaDue(ticker, horizon)],
      sessionDateSchema.parse(close),
    );
    const repository = new ResearchScoresRepository(db, owner);
    const { engine } = fakeEngine({ ok: false, error: { code: "insufficient_data" } });

    const early = await scoreDueResearch(db, horizon, { engine });
    expect(early).toMatchObject({ skipped: 1, errors: 0, scored: 0 });
    expect((await repository.findForIdeas(ideaIds)).size).toBe(0);

    const late = await scoreDueResearch(db, after.at(-1) ?? horizon, { engine });
    expect(late).toMatchObject({ errors: 1 });
    const [row] = [...(await repository.findForIdeas(ideaIds)).values()];
    expect(row).toMatchObject({ unscorableReason: "insufficient_data", claimHeld: null });
    expect(researchCalibration(row ? [row] : [])[0]).toMatchObject({ scored: 0 });
    expect(await scoreDueResearch(db, after.at(-1) ?? horizon, { engine })).toMatchObject({
      skipped: 0,
    });
  });

  it("records any other engine error as terminal for that idea", async () => {
    const db = getDb();
    const owner = await insertBareUser("engine-error");
    const ticker = randomTicker();
    const { close, horizon } = await calendar();
    const { ideaIds } = await seedResearchFor(owner, [ideaDue(ticker, horizon)], close);

    await scoreDueResearch(db, horizon, {
      engine: fakeEngine({ ok: false, error: { code: "invalid_input" } }).engine,
    });

    const [row] = [
      ...(await new ResearchScoresRepository(db, owner).findForIdeas(ideaIds)).values(),
    ];
    expect(row).toMatchObject({ unscorableReason: "engine_error:invalid_input" });
  });

  it("counts only the latest research of a close, and keeps the older closes' own", async () => {
    const db = getDb();
    const owner = await insertBareUser("latest-per-close");
    const ticker = randomTicker();
    const { close, horizon } = await calendar();
    const olderClose = sessionDateSchema.parse(sessionOffset(close, -1));
    await insertSession(olderClose);
    const earlier = await seedResearchFor(owner, [ideaDue(ticker, horizon)], close);
    const latest = await seedResearchFor(owner, [ideaDue(ticker, horizon)], close);
    const other = await seedResearchFor(owner, [ideaDue(ticker, horizon)], olderClose);

    await scoreDueResearch(db, horizon, { engine: fakeEngine({ ok: true, value: SCORE }).engine });

    const rows = await new ResearchScoresRepository(db, owner).allMine();
    expect(rows.map((row) => row.ideaId).sort()).toEqual(
      [...latest.ideaIds, ...other.ideaIds].sort(),
    );
    expect(rows.map((row) => row.ideaId)).not.toContain(earlier.ideaIds[0]);
    expect(researchCalibration(rows)[0]).toMatchObject({ scored: 2, unscorable: 0 });
  });

  it("settles an idea whose stored lot no longer parses as terminal instead of leaving it due", async () => {
    const db = getDb();
    const owner = await insertBareUser("invalid-stored");
    const ticker = randomTicker();
    const { close, horizon } = await calendar();
    const { ideaIds } = await seedResearchFor(owner, [ideaDue(ticker, horizon)], close);
    const [seeded] = await db
      .select()
      .from(researchIdeas)
      .where(eq(researchIdeas.id, ideaIds[0] ?? ""));
    if (!seeded) throw new Error("seed stored no idea");
    const { id: seededId, ...rest } = seeded;
    await db
      .insert(researchIdeas)
      .values({ ...rest, position: 9, legs: [{ role: "unknown" }] as never });
    const invalidId = (await new ResearchRepository(db, owner).ideaIdsOf(seeded.researchId)).find(
      (id) => id !== seededId,
    );
    if (!invalidId) throw new Error("the broken idea was not stored");
    const { score, engine } = fakeEngine({ ok: true, value: SCORE });

    expect(await scoreDueResearch(db, horizon, { engine })).toMatchObject({ scored: 1, errors: 1 });
    expect(score).toHaveBeenCalledTimes(1);
    const repository = new ResearchScoresRepository(db, owner);
    const [row] = [...(await repository.findForIdeas([invalidId])).values()];
    expect(row).toMatchObject({ unscorableReason: "invalid_stored_idea" });
    expect(await repository.dueForUser(horizon)).toEqual({ due: [], invalid: [] });
  });

  it("starts no user past the deadline", async () => {
    const db = getDb();
    const owner = await insertBareUser("deadline");
    const ticker = randomTicker();
    const { close, horizon } = await calendar();
    await seedResearchFor(owner, [ideaDue(ticker, horizon)], close);
    const { score, engine } = fakeEngine({ ok: true, value: SCORE });

    const outcome = await scoreDueResearch(db, horizon, { deadlineAt: 0, now: () => 1, engine });

    expect(score).not.toHaveBeenCalled();
    expect(outcome.scored).toBe(0);
    expect((await new ResearchScoresRepository(db, owner).dueForUser(horizon)).due).toHaveLength(1);
  });
});

describe("assembleResearchInputs against the database (docs/adr/0076)", () => {
  it("sends only the filings delivered before the newest close's day, never one that came after", async () => {
    const db = getDb();
    const ticker = randomTicker();
    const cnpj = String(Math.floor(Math.random() * 1e14)).padStart(14, "0");
    createdCnpjs.push(cnpj);
    await insertSession(NEWEST_CLOSE);
    await db.insert(companyTickers).values({ ticker, cnpj, referenceDate: "2026-09-01" });

    const deliveries = [
      ["known", "2026-10-20"],
      ["same-day", NEWEST_CLOSE],
      ["after", "2026-10-26"],
    ] as const;
    for (const [label, deliveredOn] of deliveries) {
      const protocol = `${cnpj}-${label}`;
      await db.insert(companyFilings).values({
        protocol,
        version: 1,
        cnpj,
        companyName: "EMPRESA TESTE S.A.",
        category: "material_fact",
        kind: null,
        subject: "Fato relevante",
        deliveredOn,
        documentUrl: `https://example.test/${protocol}`,
      });
      await recordFinalFilingLabel(
        db,
        { protocol, version: 1 },
        { outcome: "labelled", topic: "buyback", tone: "positive", summary: `Resumo ${label}.` },
        null,
      );
    }

    const built = await assembleResearchInputs(db, {
      newestClose: NEWEST_CLOSE,
      ideas: [
        {
          ...ideaOf(ticker),
          pricing: {
            ...pricing,
            riskFreeRate: "0.1065",
            dividendYield: "0",
            greeks: { delta: "0.4", gamma: "0.1", theta: "-0.02", vega: "0.1", rho: "0.05" },
            limitBreaches: [],
            notes: [],
          } as unknown as OperationPricing,
        },
      ],
      now: new Date("2026-10-27T12:00:00Z"),
    });
    if (!built.ok) throw new Error("expected inputs");
    const [idea] = (built.inputs.facts as { ideas: { filings: { summary: string }[] | null }[] })
      .ideas;
    expect(idea?.filings?.map((filing) => filing.summary)).toEqual(["Resumo known."]);
  });
});
