import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  confidenceSchema,
  decimalStringSchema,
  type AnalysisInputs,
  type AnalysisOutputV2,
} from "@fetha/contracts";
import type { Score } from "@fetha/engine";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import { AnalysesRepository, type AnalysisClaim } from "./analyses-repository";
import { AnalysisScoresRepository } from "./analysis-scores-repository";
import { dueAnalysisUserIds } from "./due-analysis-users";
import { analysisResults, analysisScores } from "./schema";

function uniqueEmail(label: string): string {
  return `fetha-analysis-scores-${label}-${crypto.randomUUID()}@example.com`;
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

const INPUTS: AnalysisInputs = {
  subject: "held_operation",
  facts: { session: "09/10/2026", underlying: "ITUB4", pricing: { spot: "R$ 35,80" } },
};

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

function claimDue(horizon: string): AnalysisClaim {
  return {
    claim: { kind: "close_above", instrument: "ITUB4", level: decimalStringSchema.parse("35.8") },
    confidence: confidenceSchema.parse("0.75"),
    horizon,
  };
}

const SCORE = {
  pnl: null,
  maxLoss: null,
  normalizedPnl: null,
  thesis: { claim: null },
  counterfactualPnl: null,
  notes: [],
  provenance: { engineVersion: "test" },
} as unknown as Score;

async function acceptedAnalysis(
  repository: AnalysesRepository,
  claim: AnalysisClaim | null,
): Promise<string> {
  const { id } = await repository.reserve({
    subjectKind: "held_operation",
    subjectId: crypto.randomUUID(),
    inputs: INPUTS,
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
    claim,
  });
  return id;
}

const createdEmails: string[] = [];

afterEach(async () => {
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(getDb(), email);
  }
});

async function twoUsers(label: string) {
  const emailA = uniqueEmail(`${label}-a`);
  const emailB = uniqueEmail(`${label}-b`);
  createdEmails.push(emailA, emailB);
  return { userA: await insertBareUser(emailA), userB: await insertBareUser(emailB) };
}

describe("accepted analyses with a claim (docs/adr/0058)", () => {
  it("lists only this user's accepted analyses, with their claim, newest first", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("journal");
    const repoA = new AnalysesRepository(db, userA);
    const repoB = new AnalysesRepository(db, userB);

    const older = await acceptedAnalysis(repoA, null);
    const newer = await acceptedAnalysis(repoA, claimDue("2026-10-16"));
    await acceptedAnalysis(repoB, claimDue("2026-10-16"));
    const { id: rejected } = await repoA.reserve({
      subjectKind: "held_operation",
      subjectId: crypto.randomUUID(),
      inputs: INPUTS,
      promptVersion: "analysis@2",
      model: "claude-opus-5-5",
    });
    await repoA.complete(rejected, {
      outcome: "rejected",
      output: null,
      reason: { kind: "outlook", problem: "level_fact" },
      model: "claude-opus-5-5",
      inputTokens: 1,
      outputTokens: 1,
    });

    const listed = await repoA.listAcceptedForJournal();
    expect(listed.map((analysis) => analysis.id)).toEqual([newer, older]);
    expect(listed[0]?.claim).toEqual(claimDue("2026-10-16"));
    expect(listed[0]?.output).toEqual(OUTPUT);
    expect(listed[1]?.claim).toBeNull();
  });

  it("refuses a claim on a rejected row and a partial claim at the database", async () => {
    const db = getDb();
    const { userA } = await twoUsers("claim-check");
    const repo = new AnalysesRepository(db, userA);
    const { id } = await repo.reserve({
      subjectKind: "held_operation",
      subjectId: crypto.randomUUID(),
      inputs: INPUTS,
      promptVersion: "analysis@2",
      model: "claude-opus-5-5",
    });
    await expect(
      repo.complete(id, {
        outcome: "rejected",
        output: null,
        reason: { kind: "schema" },
        model: "claude-opus-5-5",
        inputTokens: 1,
        outputTokens: 1,
        claim: claimDue("2026-10-16"),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(analysisResults).values({
        userId: userA.id,
        requestId: id,
        outcome: "accepted",
        output: OUTPUT,
        claim: claimDue("2026-10-16").claim,
      }),
    ).rejects.toThrow();
  });
});

describe("AnalysisScoresRepository isolation", () => {
  it("lists only this user's due analyses, and the due-user list names both", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("due");
    const dueA = await acceptedAnalysis(new AnalysesRepository(db, userA), claimDue("2026-10-16"));
    await acceptedAnalysis(new AnalysesRepository(db, userA), claimDue("2026-10-30"));
    await acceptedAnalysis(new AnalysesRepository(db, userA), null);
    const dueB = await acceptedAnalysis(new AnalysesRepository(db, userB), claimDue("2026-10-16"));

    const repoA = new AnalysisScoresRepository(db, userA);
    const rowsA = await repoA.dueForUser("2026-10-16");
    expect(rowsA.map((row) => row.requestId)).toEqual([dueA]);
    expect(rowsA[0]).toMatchObject({ confidence: "0.75", horizon: "2026-10-16" });

    const rowsB = await new AnalysisScoresRepository(db, userB).dueForUser("2026-10-16");
    expect(rowsB.map((row) => row.requestId)).toEqual([dueB]);

    const users = await dueAnalysisUserIds(db, "2026-10-16");
    expect(users).toEqual(expect.arrayContaining([userA.id, userB.id]));

    await repoA.insertIfAbsent({ requestId: dueA, unscorableReason: "x", engineVersion: "test" });
    expect(await repoA.dueForUser("2026-10-16")).toEqual([]);
  });

  it("user A cannot score, read or aggregate user B's analysis", async () => {
    const db = getDb();
    const { userA, userB } = await twoUsers("iso");
    const requestB = await acceptedAnalysis(
      new AnalysesRepository(db, userB),
      claimDue("2026-10-16"),
    );
    const repoA = new AnalysisScoresRepository(db, userA);
    const repoB = new AnalysisScoresRepository(db, userB);

    await expect(
      repoA.insertIfAbsent({ requestId: requestB, unscorableReason: "x", engineVersion: "test" }),
    ).rejects.toThrow();

    await repoB.insertIfAbsent({
      requestId: requestB,
      score: SCORE,
      claimHeld: true,
      brier: decimalStringSchema.parse("0.0625"),
      engineVersion: "test",
    });

    expect((await repoA.findForRequests([requestB])).size).toBe(0);
    expect((await repoB.findForRequests([requestB])).get(requestB)).toMatchObject({
      claimHeld: true,
    });
    expect(await repoA.trackRecordStats()).toEqual({
      scoredCount: 0,
      claimsHeldCount: 0,
      meanBrier: null,
      likelihoodBuckets: [],
    });
    expect(await repoB.trackRecordStats()).toEqual({
      scoredCount: 1,
      claimsHeldCount: 1,
      meanBrier: "0.0625",
      likelihoodBuckets: [{ likelihood: "likely", count: 1, heldCount: 1 }],
    });
  });

  it("is idempotent and append-only", async () => {
    const db = getDb();
    const { userA } = await twoUsers("append-only");
    const request = await acceptedAnalysis(
      new AnalysesRepository(db, userA),
      claimDue("2026-10-16"),
    );
    const repo = new AnalysisScoresRepository(db, userA);
    expect(
      await repo.insertIfAbsent({ requestId: request, unscorableReason: "a", engineVersion: "t" }),
    ).toEqual({ inserted: true });
    expect(
      await repo.insertIfAbsent({ requestId: request, unscorableReason: "b", engineVersion: "t" }),
    ).toEqual({ inserted: false });
    await expect(
      db
        .update(analysisScores)
        .set({ unscorableReason: "edited" })
        .where(eq(analysisScores.requestId, request)),
    ).rejects.toThrow();
    const [row] = await db
      .select({ reason: analysisScores.unscorableReason })
      .from(analysisScores)
      .where(eq(analysisScores.requestId, request));
    expect(row?.reason).toBe("a");
  });
});
