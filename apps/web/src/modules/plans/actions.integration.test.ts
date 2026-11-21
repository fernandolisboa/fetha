import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { OperationPricing, Result } from "@fetha/engine";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { structures } from "@/modules/strategies/schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(currentUser);
    },
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(new Repository(db, currentUser));
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// `getCurrentRiskProfile` logs an access-log row from the request's own headers
// (`modules/audit`), unavailable outside a real Next.js request; every other assertion here is
// about the plan's own writes, not the access log, the same scope `operations-actions.integration.test.ts`
// keeps for its own mocks.
vi.mock("@/modules/audit", async () => {
  const actual = await vi.importActual<typeof import("@/modules/audit")>("@/modules/audit");
  return { ...actual, recordAccess: () => Promise.resolve() };
});

const CALENDAR = [
  {
    date: "2027-01-15",
    open: new Date("2027-01-15T13:00:00.000Z"),
    close: new Date("2027-01-15T20:00:00.000Z"),
  },
];
const SERIES_ASOF = "2020-01-01T00:00:00.000Z";

// Mutable so a test can simulate the newest *ingested* session trailing the newest *closed*
// calendar session (round 3 review): the calendar above always has 2027-01-15 as its latest
// entry, but `latestCandle` can point at an earlier one, and `tradingSessionForDate` echoes
// back whichever date it is asked to resolve — the same session a candle names.
let candleSession = "2027-01-02";

vi.mock("@/modules/market-data", async () => {
  const actual =
    await vi.importActual<typeof import("@/modules/market-data")>("@/modules/market-data");
  return {
    ...actual,
    buildOperationMarketView: () =>
      Promise.resolve({
        calendar: CALENDAR,
        candles: [],
        corporateActions: [],
        optionSeries: [
          {
            ticker: "PETR4K36",
            underlying: "PETR4",
            right: "call",
            strike: "36.000000",
            expiry: "2027-01-15",
            style: "european",
            asOf: SERIES_ASOF,
          },
          {
            ticker: "PETR4K38",
            underlying: "PETR4",
            right: "call",
            strike: "38.000000",
            expiry: "2027-01-15",
            style: "european",
            asOf: SERIES_ASOF,
          },
        ],
        optionPrices: [
          {
            ticker: "PETR4K36",
            session: candleSession,
            asOf: `${candleSession}T20:00:00.000Z`,
            average: "1.500000",
            close: "1.500000",
            trades: 10,
            tradedQuantity: 1000,
          },
          {
            ticker: "PETR4K38",
            session: candleSession,
            asOf: `${candleSession}T20:00:00.000Z`,
            average: "0.800000",
            close: "0.800000",
            trades: 10,
            tradedQuantity: 1000,
          },
        ],
        quotes: [],
        macro: [],
        dividendYields: [],
        impliedVolatilityIndex: [],
      }),
    latestCandle: () =>
      Promise.resolve({
        ticker: "PETR4",
        session: candleSession,
        asOf: `${candleSession}T20:00:00.000Z`,
        open: "35.000000",
        high: "36.500000",
        low: "34.500000",
        close: "36.000000",
        tradedQuantity: "1000000",
      }),
    tradingSessionForDate: (_db: unknown, date: string) =>
      Promise.resolve({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      }),
    nthSessionBefore: () =>
      Promise.resolve({
        date: "2027-01-08",
        open: new Date("2027-01-08T13:00:00.000Z"),
        close: new Date("2027-01-08T20:00:00.000Z"),
      }),
  };
});

function lotsOf(legsInput: unknown): number {
  const first = (Array.isArray(legsInput) ? legsInput[0] : legsInput) as { quantity: number };
  return first.quantity / 100;
}

function okPricing(lots: number): OperationPricing {
  const leg = (
    side: "buy" | "sell",
    ticker: string,
    price: string,
  ): OperationPricing["legs"][number] => ({
    leg: {
      role: "call",
      side,
      ticker,
      quantity: 100 * lots,
    } as OperationPricing["legs"][number]["leg"],
    price: price as OperationPricing["spot"],
    priceSource: "last",
    stale: null,
    fairValue: price as OperationPricing["spot"],
    impliedVolatility: "0.300000" as OperationPricing["spot"],
    volatilitySource: "last_trade_implied",
    greeks: null,
    timeToExpiryYears: "0.100000" as OperationPricing["spot"],
    notes: [],
  });
  return {
    at: "2027-01-02T14:00:00.000Z",
    underlying: "PETR4",
    spot: "36.000000" as OperationPricing["spot"],
    riskFreeRate: "0.100000" as OperationPricing["riskFreeRate"],
    dividendYield: "0.000000" as OperationPricing["dividendYield"],
    legs: [leg("buy", "PETR4K36", "1.500000"), leg("sell", "PETR4K38", "0.800000")],
    netPremium: (-70 * lots) as OperationPricing["netPremium"],
    greeks: {
      delta: "0.300000" as OperationPricing["greeks"]["delta"],
      gamma: "0.010000" as OperationPricing["greeks"]["gamma"],
      theta: "-0.020000" as OperationPricing["greeks"]["theta"],
      vega: "0.050000" as OperationPricing["greeks"]["vega"],
      rho: "0.010000" as OperationPricing["greeks"]["rho"],
    },
    payoff: [],
    breakEvens: ["36.700000" as OperationPricing["spot"]],
    maxLoss: (1_000 * lots) as OperationPricing["maxLoss"],
    maxGain: (13_000 * lots) as OperationPricing["maxGain"],
    limitBreaches: [],
    notes: [],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}

const priceOperationCalls: string[] = [];

vi.mock("@fetha/engine", async () => {
  const actual = await vi.importActual<typeof import("@fetha/engine")>("@fetha/engine");
  return {
    ...actual,
    engine: {
      ...actual.engine,
      assetReading: () =>
        Promise.resolve({
          ok: true,
          value: { impliedVolatility: { label: "low" } },
        }),
      priceOperation: (input: { legs: unknown; at: string }): Promise<Result<OperationPricing>> => {
        priceOperationCalls.push(input.at);
        return Promise.resolve({ ok: true, value: okPricing(lotsOf(input.legs)) });
      },
    },
  };
});

const { buildPlanAction, savePlanAction } = await import("./actions");
const { OperationsRepository } = await import("@/modules/portfolio");
const { PlanRulesRepository } = await import("./plan-rules-repository");
const { DecisionsRepository } = await import("@/modules/decisions");

function uniqueEmail(label: string): string {
  return `fetha-plans-actions-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertBareUser(email: string): Promise<CurrentUser> {
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
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) throw new Error("failed to insert test user");
  return row;
}

async function ensureBullCallSpreadStructure(): Promise<void> {
  await getDb()
    .insert(structures)
    .values({
      id: "bull-call-spread",
      name: "Trava de alta com calls",
      legs: [
        { role: "call", side: "buy", ratio: 1, strikeRank: 1 },
        { role: "call", side: "sell", ratio: 1, strikeRank: 2 },
      ],
    })
    .onConflictDoNothing();
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  priceOperationCalls.splice(0);
  candleSession = "2027-01-02";
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("buildPlanAction", () => {
  it("builds a plan for a user with no declared risk profile, falling back to the default", async () => {
    await ensureBullCallSpreadStructure();
    const email = uniqueEmail("no-profile");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const outcome = await buildPlanAction({ kind: "view", underlying: "PETR4", view: "up" });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.plan.structureId).toBe("bull-call-spread");
    expect(outcome.plan.lots).toBeGreaterThan(0);
    expect(typeof outcome.fingerprint).toBe("string");
  });

  // Round 2 review, the accepted blocking item: a build made "during the next session" (real
  // wall-clock time is long past the latest ingested close here) must still price at the latest
  // ingested close, not at `nowInstant()` — otherwise every leg's own-session price looks stale
  // against a session that has not closed yet, and the build always refuses with "stale_prices".
  it("prices every leg at the latest ingested close, not at the real current instant", async () => {
    await ensureBullCallSpreadStructure();
    const email = uniqueEmail("prices-at-close");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const outcome = await buildPlanAction({ kind: "view", underlying: "PETR4", view: "up" });

    expect(outcome.status).toBe("ok");
    expect(priceOperationCalls.length).toBeGreaterThan(0);
    for (const at of priceOperationCalls) {
      expect(at).toBe("2027-01-02T20:00:00.000Z");
    }
  });

  // Round 3 review: the calendar's own newest session can already be closed (or even several
  // sessions past) while the nightly ingestion is still running or has failed outright, so
  // anchoring to "the newest closed calendar session" prices against a close nothing was ever
  // ingested for. This simulates that gap directly: the newest ingested candle is for an earlier
  // session than the calendar otherwise carries, and the build must still price at that candle's
  // own session, not refuse.
  it("prices at the newest ingested candle's session even when the calendar has a later one closed", async () => {
    await ensureBullCallSpreadStructure();
    const email = uniqueEmail("ingestion-lag");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    candleSession = "2027-01-10";

    const outcome = await buildPlanAction({ kind: "view", underlying: "PETR4", view: "up" });

    expect(outcome.status).toBe("ok");
    expect(priceOperationCalls.length).toBeGreaterThan(0);
    for (const at of priceOperationCalls) {
      expect(at).toBe("2027-01-10T20:00:00.000Z");
    }
  });
});

describe("savePlanAction", () => {
  it("writes the contemplated operation, its plan rules and an enter decision together, linked by operation id", async () => {
    await ensureBullCallSpreadStructure();
    const email = uniqueEmail("save-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const built = await buildPlanAction({ kind: "view", underlying: "PETR4", view: "up" });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;

    const saved = await savePlanAction({
      kind: "view",
      underlying: "PETR4",
      view: "up",
      fingerprint: built.fingerprint,
    });
    expect(saved.status).toBe("ok");
    if (saved.status !== "ok") return;

    const operationsRepo = new OperationsRepository(getDb(), currentUser);
    const operation = await operationsRepo.findMine(saved.operationId);
    expect(operation.structureId).toBe("bull-call-spread");

    const planRulesRepo = new PlanRulesRepository(getDb(), currentUser);
    const rules = await planRulesRepo.findByOperation(saved.operationId);
    expect(rules?.recipeId).toBe("bull-call-spread-low-iv");

    const decisionsRepo = new DecisionsRepository(getDb(), currentUser);
    const decisions = await decisionsRepo.findLatestForOperations([saved.operationId]);
    const decision = decisions.get(saved.operationId);
    expect(decision?.kind).toBe("enter");
    expect(decision?.contemplatedOperationId).toBe(saved.operationId);
  });

  it("rejects the save when the plan changed since the user reviewed it", async () => {
    await ensureBullCallSpreadStructure();
    const email = uniqueEmail("mismatch");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const saved = await savePlanAction({
      kind: "view",
      underlying: "PETR4",
      view: "up",
      fingerprint: "stale-fingerprint-from-a-different-screen",
    });
    expect(saved).toEqual({ status: "error", error: "plan_changed" });
  });

  it("isolates a saved plan from another user: no read, no overwrite", async () => {
    await ensureBullCallSpreadStructure();
    const emailA = uniqueEmail("isolation-a");
    const emailB = uniqueEmail("isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertBareUser(emailA);
    const userB = await insertBareUser(emailB);

    currentUser = userA;
    const built = await buildPlanAction({ kind: "view", underlying: "PETR4", view: "up" });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    const saved = await savePlanAction({
      kind: "view",
      underlying: "PETR4",
      view: "up",
      fingerprint: built.fingerprint,
    });
    expect(saved.status).toBe("ok");
    if (saved.status !== "ok") return;

    currentUser = userB;
    const operationsRepoB = new OperationsRepository(getDb(), userB);
    await expect(operationsRepoB.findMine(saved.operationId)).rejects.toThrow();

    const planRulesRepoB = new PlanRulesRepository(getDb(), userB);
    expect(await planRulesRepoB.findByOperation(saved.operationId)).toBeNull();

    const decisionsRepoB = new DecisionsRepository(getDb(), userB);
    expect((await decisionsRepoB.findLatestForOperations([saved.operationId])).size).toBe(0);
  });
});
