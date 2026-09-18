import { afterEach, describe, expect, it } from "vitest";
import {
  tickerSchema,
  type DecimalString,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { SignalsRepository, type NewEvaluation, type NewSignal } from "./signals-repository";
import { StrategiesRepository } from "./strategies-repository";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function uniqueEmail(label: string): string {
  return `fetha-signals-repo-${label}-${crypto.randomUUID()}@example.com`;
}

function randomTicker(): Ticker {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  return tickerSchema.parse(`SR${suffix}`);
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
    name: "SR test",
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

function newSignal(strategyId: string, versionId: string, ticker: Ticker): NewSignal {
  return {
    strategyId,
    strategyVersionId: versionId,
    ticker,
    timeframe: "D1",
    session: "2031-06-01",
    at: new Date("2031-06-01T21:00:00.000Z"),
    kind: "entry",
    indicators: [],
    proposal: null,
    operationId: null,
    rule: null,
  };
}

function newEvaluation(strategyId: string, versionId: string, ticker: Ticker): NewEvaluation {
  return {
    strategyId,
    strategyVersionId: versionId,
    ticker,
    session: "2031-06-01",
    at: new Date("2031-06-01T21:00:00.000Z"),
    outcome: "conditions_not_met",
    detail: null,
  };
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("SignalsRepository isolation", () => {
  it("user A cannot read, count or mark read user B's signal", async () => {
    const db = getDb();
    const emailA = uniqueEmail("a");
    const emailB = uniqueEmail("b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategyB = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const versionB = strategyB.versions[0];
    if (!versionB) throw new Error("test setup: expected a version");

    const repoB = new SignalsRepository(db, userB);
    await repoB.createSignals([newSignal(strategyB.id, versionB.id, randomTicker())]);

    const repoA = new SignalsRepository(db, userA);
    expect(await repoA.listInbox()).toEqual([]);
    expect(await repoA.unreadCount()).toBe(0);
    expect(await repoB.unreadCount()).toBe(1);

    const [signalB] = await repoB.listInbox();
    if (!signalB) throw new Error("test setup: expected a signal");

    await repoA.markRead(signalB.id);
    expect(await repoB.unreadCount()).toBe(1);
  });

  it("createSignals is idempotent for the same user, strategy version, ticker and session", async () => {
    const db = getDb();
    const email = uniqueEmail("idempotent");
    createdEmails.push(email);
    const owner = await insertBareUser(email);

    const strategy = await new StrategiesRepository(db, owner).createWithVersion(definition());
    const version = strategy.versions[0];
    if (!version) throw new Error("test setup: expected a version");
    const ticker = randomTicker();

    const repository = new SignalsRepository(db, owner);
    const first = await repository.createSignals([newSignal(strategy.id, version.id, ticker)]);
    const second = await repository.createSignals([newSignal(strategy.id, version.id, ticker)]);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(await repository.listInbox()).toHaveLength(1);
  });

  it("user A's evaluation log is empty after user B writes an evaluation", async () => {
    const db = getDb();
    const emailA = uniqueEmail("eval-a");
    const emailB = uniqueEmail("eval-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategyB = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const versionB = strategyB.versions[0];
    if (!versionB) throw new Error("test setup: expected a version");

    const tickerB = randomTicker();
    const repoB = new SignalsRepository(db, userB);
    await repoB.createEvaluations([newEvaluation(strategyB.id, versionB.id, tickerB)]);

    const repoA = new SignalsRepository(db, userA);
    expect(await repoA.listEvaluationLog()).toEqual([]);

    const logB = await repoB.listEvaluationLog();
    expect(logB).toHaveLength(1);
    expect(logB.every((row) => row.ticker === tickerB)).toBe(true);

    // The watermark read is user-scoped too (#19 round 3 item 8): user A's
    // read for user B's own strategy version stays null even though B just
    // wrote an evaluation for it, and B's own read sees it.
    expect(await repoA.lastEvaluatedSession(versionB.id)).toBeNull();
    expect(await repoB.lastEvaluatedSession(versionB.id)).toBe("2031-06-01");
  });

  // Strengthened over a prior version of this case that shared no key axis
  // between the two users and so would have passed even with the tenant
  // predicate removed from `markRead` (round 5 item 2 advisory): user A's
  // `markRead` targets user B's own signal id directly, colliding on the
  // write's own predicate (`id`), with only `userId` distinguishing them.
  it("markRead's own predicate, not merely a different key, keeps user A from marking user B's signal read", async () => {
    const db = getDb();
    const emailA = uniqueEmail("markread-a");
    const emailB = uniqueEmail("markread-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    const strategyB = await new StrategiesRepository(db, userB).createWithVersion(definition());
    const versionB = strategyB.versions[0];
    if (!versionB) throw new Error("test setup: expected a version");

    const tickerB = randomTicker();
    const repoB = new SignalsRepository(db, userB);
    await repoB.createSignals([newSignal(strategyB.id, versionB.id, tickerB)]);
    const [signalB] = await repoB.listInbox();
    if (!signalB) throw new Error("test setup: expected a signal");
    expect(signalB.readAt).toBeNull();

    const repoA = new SignalsRepository(db, userA);
    await repoA.markRead(signalB.id);

    const [stillUnread] = await repoB.listInbox();
    expect(stillUnread?.readAt).toBeNull();
    expect(await repoB.unreadCount()).toBe(1);
  });
});
