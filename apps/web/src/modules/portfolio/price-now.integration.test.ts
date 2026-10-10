import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { ContemplatedLeg, RiskProfile } from "@fetha/contracts";
import { quantitySchema, tickerSchema } from "@fetha/contracts";
import type { OperationPricing, Result } from "@fetha/engine";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedOperation } from "@/db/test/held-operation";
import { user } from "@/modules/auth/schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

function dummyPricing(): OperationPricing {
  return {
    at: "2026-09-10T14:00:00.000Z",
    underlying: "PETR4",
    spot: "0.000000" as OperationPricing["spot"],
    riskFreeRate: "0.000000" as OperationPricing["riskFreeRate"],
    dividendYield: "0.000000" as OperationPricing["dividendYield"],
    legs: [],
    netPremium: 0 as OperationPricing["netPremium"],
    greeks: {
      delta: "0.000000" as OperationPricing["greeks"]["delta"],
      gamma: "0.000000" as OperationPricing["greeks"]["gamma"],
      theta: "0.000000" as OperationPricing["greeks"]["theta"],
      vega: "0.000000" as OperationPricing["greeks"]["vega"],
      rho: "0.000000" as OperationPricing["greeks"]["rho"],
    },
    payoff: [],
    breakEvens: [],
    maxLoss: 0 as OperationPricing["maxLoss"],
    maxGain: 0 as OperationPricing["maxGain"],
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

const priceOperationLegsMock = vi
  .fn<
    (
      underlying: string,
      legs: ContemplatedLeg[],
      riskProfile: RiskProfile | null,
      openOperationCount: number,
    ) => Promise<Result<OperationPricing>>
  >()
  .mockResolvedValue({ ok: true, value: dummyPricing() });

vi.mock("./engine-client", () => ({
  priceOperationLegs: (
    underlying: string,
    legs: ContemplatedLeg[],
    riskProfile: RiskProfile | null,
    openOperationCount: number,
  ) => priceOperationLegsMock(underlying, legs, riskProfile, openOperationCount),
}));

const { priceOperationNow } = await import("./price-now");
const { RiskProfileRepository } = await import("./risk-profile-repository");

function uniqueEmail(label: string): string {
  return `fetha-price-now-${label}-${crypto.randomUUID()}@example.com`;
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
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function profile(maxOpenOperations: number): RiskProfile {
  return {
    declaredCapital: 10000000,
    limits: {
      maxLossPerOperation: "0.02" as RiskProfile["limits"]["maxLossPerOperation"],
      maxExposurePerOperation: "0.1" as RiskProfile["limits"]["maxExposurePerOperation"],
      maxOpenOperations,
      maxPremiumBought: "0.05" as RiskProfile["limits"]["maxPremiumBought"],
    },
  } as RiskProfile;
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  priceOperationLegsMock.mockClear();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

const SOME_LEGS: ContemplatedLeg[] = [
  {
    role: "stock",
    side: "buy",
    ticker: tickerSchema.parse("PETR4"),
    quantity: quantitySchema.parse(100),
  },
];

describe("priceOperationNow at exactly maxOpenOperations", () => {
  it("excludes the held operation itself from the live count it re-prices against", async () => {
    const email = uniqueEmail("held-exclude");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    const db = getDb();

    await new RiskProfileRepository(db, currentUser).declare(profile(3));

    const operationIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { operationId } = await seedOperation(db, currentUser, [
        {
          ticker: tickerSchema.parse("PETR4"),
          side: "buy",
          quantity: 100,
          price: "30",
          session: "2031-06-02",
        },
      ]);
      operationIds.push(operationId);
    }
    const heldOperationId = operationIds[0];
    if (!heldOperationId) {
      throw new Error("test setup: no operation id");
    }

    await priceOperationNow("PETR4", SOME_LEGS, { excludeOperationId: heldOperationId });

    expect(priceOperationLegsMock).toHaveBeenCalledWith("PETR4", SOME_LEGS, expect.anything(), 2);
  });

  it("counts every live open operation for a contemplated operation (no exclusion)", async () => {
    const email = uniqueEmail("contemplated-no-exclude");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    const db = getDb();

    await new RiskProfileRepository(db, currentUser).declare(profile(3));

    for (let i = 0; i < 3; i += 1) {
      await seedOperation(db, currentUser, [
        {
          ticker: tickerSchema.parse("PETR4"),
          side: "buy",
          quantity: 100,
          price: "30",
          session: "2031-06-02",
        },
      ]);
    }

    await priceOperationNow("PETR4", SOME_LEGS);

    expect(priceOperationLegsMock).toHaveBeenCalledWith("PETR4", SOME_LEGS, expect.anything(), 3);
  });
});
