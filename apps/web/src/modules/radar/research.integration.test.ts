import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  riskProfileSchema,
  sessionDateSchema,
  tickerSchema,
  type RiskProfile,
  type Ticker,
} from "@fetha/contracts";

import { getDb, type Database } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedStockOperation } from "@/db/test/held-operation";
import {
  cleanRadarFixture,
  EXPIRY_INDEX,
  SCAN_INDEX,
  SCAN_SESSION,
  seedRadarFixture,
  SESSIONS,
  type Scenario,
} from "@/db/test/radar-fixture";
import type { CurrentUser } from "@/modules/auth";
import { user } from "@/modules/auth/schema";
import { RiskProfileRepository } from "@/modules/portfolio/risk-profile-repository";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { scanRadar } from "./scan";
import { suggestions } from "./schema";

let currentUser: CurrentUser | null = null;

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(currentUser);
    },
  };
});

const { researchSuggestions } = await import("./research");
const { researchSuggestionsAction } = await import("./research-actions");

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase();
const ticker = (prefix: string): Ticker => tickerSchema.parse(`${prefix}${suffix}3`);

const trend = (index: number) => 10 * (1 + 0.0015 * index) + 0.15 * Math.sin(index * 0.9);
// Same up trend as the scan fixtures; one keeps going after the scanned close, the other crashes.
const HOLDS: Scenario = {
  ticker: ticker("ZQH"),
  close: trend,
  iv: (index) => 0.5 - 0.002 * index,
  optionsTradeOn: () => true,
  ivPointOn: () => true,
};
const BREAKS: Scenario = {
  ...HOLDS,
  ticker: ticker("ZQB"),
  close: (index) => (index <= SCAN_INDEX ? trend(index) : 5 + 0.01 * index),
  iv: (index) => (index <= SCAN_INDEX ? 0.5 - 0.002 * index : 0.9),
};

const BULL_CALL = "bull-call-spread-low-iv";
const LONG_CALL = "long-call-low-iv";

function afterClose(index: number): Date {
  return new Date(`${SESSIONS[index] ?? ""}T21:00:00.000Z`);
}

const NOW = afterClose(SCAN_INDEX + 2);
const far = Number.MAX_SAFE_INTEGER;

function profile(fields: { capital: number; maxLoss?: string; maxOpen?: number }): RiskProfile {
  return riskProfileSchema.parse({
    declaredCapital: fields.capital,
    limits: {
      maxLossPerOperation: fields.maxLoss ?? "0.02",
      maxExposurePerOperation: "1",
      maxOpenOperations: fields.maxOpen ?? 50,
      maxPremiumBought: "1",
    },
  });
}

const createdEmails: string[] = [];

async function insertUser(label: string): Promise<CurrentUser> {
  const email = `fetha-radar-research-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning();
  if (!row) throw new Error("failed to insert test user");
  return row;
}

beforeAll(async () => {
  await seedRadarFixture([HOLDS, BREAKS]);
  const outcome = await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });
  expect(outcome).toMatchObject({ status: "ok", universe: 2, errors: 0 });
}, 240_000);

afterEach(async () => {
  currentUser = null;
  vi.useRealTimers();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(getDb(), email);
  }
});

afterAll(async () => {
  await cleanRadarFixture();
});

function research(
  overrides: Partial<Parameters<typeof researchSuggestions>[1]> = {},
): ReturnType<typeof researchSuggestions> {
  return researchSuggestions(getDb(), {
    riskProfile: null,
    openOperationCount: 0,
    now: NOW,
    deadlineAt: far,
    ...overrides,
  });
}

describe("researchSuggestions (#356)", () => {
  it("re-checks a finding from 2 sessions ago at the newest close: still holding or no longer", async () => {
    const result = await research();

    expect(result.newestClose).toBe(SESSIONS[SCAN_INDEX + 2]);
    expect(result.sessionsLooked).toBe(1);
    expect(result.usingDefaultProfile).toBe(true);
    expect(result.timedOut).toBe(false);

    const holding = result.holding.filter((idea) => idea.underlying === HOLDS.ticker);
    expect(holding.map((idea) => idea.recipeId)).toEqual(
      expect.arrayContaining([BULL_CALL, LONG_CALL]),
    );
    const [first] = holding;
    expect(first?.foundOn).toBe(SCAN_SESSION);
    expect(first?.alerts.map((alert) => alert.kind)).not.toContain("rule_no_longer_holds");
    expect(first?.expiry).toBe(SESSIONS[EXPIRY_INDEX]);
    expect(first?.sessionsToExpiry).toBe(EXPIRY_INDEX - (SCAN_INDEX + 2));

    const broken = result.noLongerHolding.filter((idea) => idea.underlying === BREAKS.ticker);
    expect(broken.map((idea) => idea.recipeId)).toContain(LONG_CALL);
    for (const idea of broken) {
      expect(idea.alerts).toContainEqual({ kind: "rule_no_longer_holds", foundOn: SCAN_SESSION });
    }
    expect(result.holding.some((idea) => idea.underlying === BREAKS.ticker)).toBe(false);
    expect(
      result.noLongerHolding.some(
        (idea) =>
          idea.underlying === HOLDS.ticker &&
          (idea.recipeId === BULL_CALL || idea.recipeId === LONG_CALL),
      ),
    ).toBe(false);
  }, 120_000);

  it("accounts for every candidate: holding, no longer holding or dropped", async () => {
    const result = await research();

    const dropped = Object.values(result.dropped).reduce((sum, count) => sum + count, 0);
    expect(result.holding.length + result.noLongerHolding.length + dropped).toBe(result.candidates);
    expect(result.candidates).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("re-prices the lot at the newest close and links the stored suggestion", async () => {
    const result = await research();
    const idea = result.holding.find(
      (entry) => entry.underlying === HOLDS.ticker && entry.recipeId === BULL_CALL,
    );
    const [stored] = await getDb()
      .select()
      .from(suggestions)
      .where(eq(suggestions.underlying, HOLDS.ticker));

    expect(idea?.suggestionId).toBeTruthy();
    expect(stored?.session).toBe(SCAN_SESSION);
    expect(idea?.legs.map((leg) => [leg.side, leg.quantity])).toEqual([
      ["buy", 100],
      ["sell", 100],
    ]);
    expect(idea?.legs.every((leg) => leg.strike !== null && leg.expiry === idea.expiry)).toBe(true);
    const today = Number(idea?.reading.close);
    expect(today).toBeCloseTo(HOLDS.close(SCAN_INDEX + 2), 2);
    expect(Number(idea?.reading.close)).not.toBeCloseTo(HOLDS.close(SCAN_INDEX), 2);
    expect(typeof idea?.maxLoss).toBe("number");
  }, 120_000);

  it("orders each group by traded series at the close, then ticker, then recipe", async () => {
    const result = await research();

    for (const group of [result.holding, result.noLongerHolding]) {
      const keys = group.map(
        (idea) => [-idea.reading.options.tradedSeries, idea.underlying, idea.recipeId] as const,
      );
      expect(keys).toEqual(
        [...keys].sort(
          (a, b) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]),
        ),
      );
    }
  }, 120_000);

  it("raises a limit breach for a profile it would not raise for the default one", async () => {
    const defaults = await research();
    const strict = await research({
      riskProfile: profile({ capital: 5_000_000, maxLoss: "0.0001" }),
    });

    const key = (idea: { underlying: string; recipeId: string }) =>
      `${idea.underlying}:${idea.recipeId}`;
    const breachesOf = (ideas: typeof strict.holding) =>
      new Map(
        ideas.map((idea) => [
          key(idea),
          idea.alerts.filter((alert) => alert.kind === "limit_breach"),
        ]),
      );
    const withDefault = breachesOf(defaults.holding);
    const withStrict = breachesOf(strict.holding);

    expect(strict.usingDefaultProfile).toBe(false);
    const target = key({ underlying: HOLDS.ticker, recipeId: LONG_CALL });
    expect(withDefault.get(target)).toEqual([]);
    expect(withStrict.get(target)).toEqual([
      {
        kind: "limit_breach",
        breach: expect.objectContaining({ limit: "maxLossPerOperation" }) as unknown,
      },
    ]);
  }, 120_000);

  it("drops a lot whose max loss is above the declared capital, counted by reason", async () => {
    const result = await research({ riskProfile: profile({ capital: 100 }) });

    expect(result.holding).toHaveLength(0);
    expect(result.noLongerHolding).toHaveLength(0);
    expect(result.dropped.exceeds_capital).toBeGreaterThan(0);
    expect(result.dropped.exceeds_capital + result.dropped.unpriced).toBe(result.candidates);
  }, 120_000);

  it("drops what no listed series prices today, as unpriced", async () => {
    const result = await research({ now: afterClose(EXPIRY_INDEX - 3) });

    expect(result.holding).toHaveLength(0);
    expect(result.noLongerHolding).toHaveLength(0);
    expect(result.dropped.unpriced).toBe(result.candidates);
  }, 120_000);

  it("stops at the deadline and says so", async () => {
    const result = await research({ deadlineAt: 0, clock: () => 1 });

    expect(result.timedOut).toBe(true);
    expect(result.holding).toHaveLength(0);
    expect(result.candidates).toBeGreaterThanOrEqual(4);
  }, 120_000);
});

describe("researchSuggestionsAction (#356) tenant isolation", () => {
  async function runAs(person: CurrentUser) {
    currentUser = person;
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const outcome = await researchSuggestionsAction();
    vi.useRealTimers();
    if (outcome.status !== "ok") throw new Error(`research failed: ${outcome.error}`);
    return outcome.result;
  }

  it("reads only the caller's risk profile and open operations", async () => {
    const owner = await insertUser("owner");
    const other = await insertUser("other");
    await new RiskProfileRepository(getDb(), owner).declare(
      profile({ capital: 5_000_000, maxOpen: 1 }),
    );
    await seedStockOperation(getDb(), owner, tickerSchema.parse("PETR4"), [
      { side: "buy", quantity: 100, price: "30", session: sessionDateSchema.parse(SCAN_SESSION) },
    ]);

    const asOwner = await runAs(owner);
    const asOther = await runAs(other);

    const openLimitBreaches = (ideas: typeof asOwner.holding) =>
      ideas.flatMap((idea) =>
        idea.alerts.filter(
          (alert) => alert.kind === "limit_breach" && alert.breach.limit === "maxOpenOperations",
        ),
      );
    expect(asOwner.usingDefaultProfile).toBe(false);
    expect(openLimitBreaches(asOwner.holding).length).toBeGreaterThan(0);
    expect(asOther.usingDefaultProfile).toBe(true);
    expect(openLimitBreaches(asOther.holding)).toHaveLength(0);
  }, 240_000);

  it("limits one account to 6 researches a minute", async () => {
    const person = await insertUser("rate");
    currentUser = person;
    vi.useFakeTimers({ toFake: ["Date"], now: afterClose(0) });

    const outcomes = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      outcomes.push(await researchSuggestionsAction());
    }

    expect(outcomes.slice(0, 6).every((outcome) => outcome.status === "ok")).toBe(true);
    expect(outcomes[6]).toEqual({ status: "error", error: "rate_limited" });
  }, 240_000);
});
