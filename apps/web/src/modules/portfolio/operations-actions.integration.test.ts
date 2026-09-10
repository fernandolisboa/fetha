import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { ContemplatedLeg } from "@fetha/contracts";
import type { OperationPricing, Result } from "@fetha/engine";

import { quantitySchema, tickerSchema } from "@fetha/contracts";
import { getDb } from "@/db/client";
import { user } from "@/db/schema/auth";
import { structures } from "@/db/schema/structures";
import { deleteTestUser } from "@/db/test/cleanup";

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

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/modules/market-data", async () => {
  const actual =
    await vi.importActual<typeof import("@/modules/market-data")>("@/modules/market-data");
  return {
    ...actual,
    latestSessionOnOrBefore: () =>
      Promise.resolve({
        date: "2026-09-10",
        open: new Date("2026-09-10T13:00:00.000Z"),
        close: new Date("2026-09-10T20:00:00.000Z"),
      }),
    optionChainForUnderlying: () => Promise.resolve([]),
  };
});

function unpriceableFairValueOnly(): OperationPricing {
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
    notes: [{ code: "no_market_price", message: "at least one leg has no visible market price" }],
    provenance: {
      engineVersion: "test",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };
}

vi.mock("./engine-client", () => ({
  priceOperationLegs: (): Promise<Result<OperationPricing>> =>
    Promise.resolve({ ok: true, value: unpriceableFairValueOnly() }),
}));

const { saveOperationAction } = await import("./operations-actions");
const { OperationsRepository } = await import("./operations-repository");

function uniqueEmail(label: string): string {
  return `fetha-operations-actions-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({ id: user.id, name: user.name, email: user.email });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

async function ensureStockStructure(): Promise<void> {
  await getDb()
    .insert(structures)
    .values({
      id: "stock",
      name: "Compra de ação",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    })
    .onConflictDoNothing();
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("saveOperationAction", () => {
  it("rejects the save when the fresh pricing carries no_market_price, and persists no row", async () => {
    await ensureStockStructure();
    const email = uniqueEmail("no-price");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const legs: ContemplatedLeg[] = [
      {
        role: "stock",
        side: "buy",
        ticker: tickerSchema.parse("PETR4"),
        quantity: quantitySchema.parse(100),
      },
    ];
    const result = await saveOperationAction({
      structureId: "stock",
      underlying: "PETR4",
      legs,
    });

    expect(result).toEqual({ status: "error", error: "no_market_price" });

    const repository = await (
      await import("@/modules/auth")
    ).forCurrentUser(getDb(), OperationsRepository);
    expect(await repository.listMine()).toHaveLength(0);
  });
});
