import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisInputs } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";

import {
  AnalysesRepository,
  AnalysisCapReachedError,
  MONTHLY_ANALYSIS_CAP,
} from "./analyses-repository";
import { analysisRequests, analysisResults } from "./schema";

function uniqueEmail(label: string): string {
  return `fetha-analyses-repo-${label}-${crypto.randomUUID()}@example.com`;
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

const SIGNAL_INPUTS: AnalysisInputs = {
  subject: "signal",
  facts: {
    session: "09/10/2026",
    kind: "entry",
    ticker: "VALE3",
    timeframe: "D1",
    indicators: [],
    rule: null,
    proposal: null,
  },
};

function reserveInput(subjectId = crypto.randomUUID()) {
  return {
    subjectKind: "signal" as const,
    subjectId,
    inputs: SIGNAL_INPUTS,
    promptVersion: "analysis@1",
    model: "claude-sonnet-5-5",
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

const ACCEPTED_OUTPUT = {
  thesis: "thesis",
  counterThesis: "counter-thesis",
  keyRisks: ["risk"],
  maxLoss: "R$ 500,00",
  breakEvens: "R$ 10,00",
  invalidation: ["condition"],
  confidence: { level: "medium" as const, justification: "justification" },
  inputsCited: ["session"],
};

describe("AnalysesRepository isolation", () => {
  it("user A cannot read user B's analysis requests or usage", async () => {
    const db = getDb();
    const emailA = uniqueEmail("iso-a");
    const emailB = uniqueEmail("iso-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const repoB = new AnalysesRepository(db, userB);
    const subjectId = crypto.randomUUID();
    const { id: requestId } = await repoB.reserve(reserveInput(subjectId));
    await repoB.complete(requestId, {
      outcome: "accepted",
      output: ACCEPTED_OUTPUT,
      reason: null,
      model: "claude-sonnet-5-5",
      inputTokens: 10,
      outputTokens: 20,
    });

    const repoA = new AnalysesRepository(db, userA);
    const usageA = await repoA.usageThisMonth();
    expect(usageA.used).toBe(0);

    const latestForA = await repoA.latestAccepted("signal", [subjectId]);
    expect(latestForA.size).toBe(0);

    const latestForB = await repoB.latestAccepted("signal", [subjectId]);
    expect(latestForB.size).toBe(1);
  });

  it("user A cannot complete user B's analysis request", async () => {
    const db = getDb();
    const emailA = uniqueEmail("complete-a");
    const emailB = uniqueEmail("complete-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const repoB = new AnalysesRepository(db, userB);
    const { id: requestId } = await repoB.reserve(reserveInput());

    const repoA = new AnalysesRepository(db, userA);
    await expect(
      repoA.complete(requestId, {
        outcome: "failed",
        output: null,
        reason: { kind: "refusal" },
        model: null,
        inputTokens: null,
        outputTokens: null,
      }),
    ).rejects.toThrow();
  });
});

describe("AnalysesRepository monthly cap (docs/adr/0057)", () => {
  it("reserves up to the cap and rejects the next one", async () => {
    const db = getDb();
    const email = uniqueEmail("cap");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    for (let i = 0; i < MONTHLY_ANALYSIS_CAP; i += 1) {
      await repository.reserve(reserveInput());
    }

    await expect(repository.reserve(reserveInput())).rejects.toBeInstanceOf(
      AnalysisCapReachedError,
    );

    const usage = await repository.usageThisMonth();
    expect(usage).toEqual({ used: MONTHLY_ANALYSIS_CAP, cap: MONTHLY_ANALYSIS_CAP });
  });

  it("does not count a failed result toward the cap", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-failed");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    const { id } = await repository.reserve(reserveInput());
    await repository.complete(id, {
      outcome: "failed",
      output: null,
      reason: { kind: "refusal" },
      model: null,
      inputTokens: null,
      outputTokens: null,
    });

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(0);
  });

  it("counts a rejected result toward the cap", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-rejected");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    const { id } = await repository.reserve(reserveInput());
    await repository.complete(id, {
      outcome: "rejected",
      output: null,
      reason: { kind: "schema" },
      model: "claude-sonnet-5-5",
      inputTokens: 10,
      outputTokens: 20,
    });

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(1);
  });

  it("counts a request with no result yet toward the cap", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-pending");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    await repository.reserve(reserveInput());

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(1);
  });

  it("counts a request with no result less than 5 minutes old", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-orphan-fresh");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    await db.insert(analysisRequests).values({
      ...reserveInput(),
      userId: owner.id,
      requestedAt: sql`now() - interval '4 minutes'`,
    });

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(1);
  });

  it("ages a request with no result out of the cap after 5 minutes", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-orphan-stale");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    await db.insert(analysisRequests).values({
      ...reserveInput(),
      userId: owner.id,
      requestedAt: sql`now() - interval '6 minutes'`,
    });

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(0);
  });

  it("does not count last month's requests", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-last-month");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    await db.insert(analysisRequests).values({
      ...reserveInput(),
      userId: owner.id,
      requestedAt: sql`now() - interval '45 days'`,
    });

    const usage = await repository.usageThisMonth();
    expect(usage.used).toBe(0);
  });

  it("admits at most the cap when reserves race at the boundary", async () => {
    const db = getDb();
    const email = uniqueEmail("cap-race");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);

    for (let i = 0; i < MONTHLY_ANALYSIS_CAP - 1; i += 1) {
      await repository.reserve(reserveInput());
    }

    const results = await Promise.allSettled([
      repository.reserve(reserveInput()),
      repository.reserve(reserveInput()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AnalysisCapReachedError);
      }
    }
  });
});

describe("AnalysesRepository append-only", () => {
  it("rejects an UPDATE on analysis_requests at the database level", async () => {
    const db = getDb();
    const email = uniqueEmail("update-requests");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);
    const { id } = await repository.reserve(reserveInput());

    await expect(
      db
        .update(analysisRequests)
        .set({ model: "claude-opus-5-5" })
        .where(eq(analysisRequests.id, id)),
    ).rejects.toThrow();
  });

  it("rejects an UPDATE on analysis_results at the database level", async () => {
    const db = getDb();
    const email = uniqueEmail("update-results");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    const repository = new AnalysesRepository(db, owner);
    const { id } = await repository.reserve(reserveInput());
    await repository.complete(id, {
      outcome: "failed",
      output: null,
      reason: { kind: "refusal" },
      model: null,
      inputTokens: null,
      outputTokens: null,
    });

    await expect(
      db
        .update(analysisResults)
        .set({ outcome: "accepted" })
        .where(eq(analysisResults.requestId, id)),
    ).rejects.toThrow();
  });
});
