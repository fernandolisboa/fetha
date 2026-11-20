import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { ContemplatedLeg } from "@fetha/contracts";
import type { OperationPricing, Result } from "@fetha/engine";

import { quantitySchema, tickerSchema } from "@fetha/contracts";
import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { structures } from "@/modules/strategies/schema";
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
    countSessionsClosedAfter: (_db: Database, date: string) =>
      Promise.resolve(date === "2026-08-20" ? 14 : 1),
    corporateActionFactorsForUnderlying: (_db: Database, ticker: string) =>
      Promise.resolve(
        ticker === "VALE3"
          ? [
              {
                ticker: "VALE3",
                exDate: "2026-09-10",
                asOf: "2026-09-09T22:00:00.000Z",
                factor: "0.500000",
              },
            ]
          : [],
      ),
    latestCandle: (_db: Database, ticker: string) =>
      Promise.resolve(
        ticker === "PETR4" || ticker === "VALE3" || ticker === "BBAS3"
          ? {
              ticker,
              session: ticker === "BBAS3" ? "2026-08-20" : "2026-09-09",
              asOf: new Date("2026-09-09T21:00:00.000Z"),
              open: "30.000000",
              high: "31.000000",
              low: "29.500000",
              close: "30.420000",
              tradedQuantity: 1000,
            }
          : null,
      ),
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

const { loadChainAction, saveOperationAction } = await import("./operations-actions");
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

describe("loadChainAction", () => {
  it("sends the underlying's last close along with its chain", async () => {
    const email = uniqueEmail("chain-spot");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    expect(await loadChainAction("PETR4")).toEqual({
      series: [],
      spot: { value: "30.420000", session: "2026-09-09" },
    });
  });

  it("has no spot when the underlying has no candle", async () => {
    const email = uniqueEmail("chain-no-spot");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    expect(await loadChainAction("ITUB4")).toEqual({ series: [], spot: null });
  });

  it("withholds a close older than a corporate action, which is on the pre-event scale", async () => {
    const email = uniqueEmail("chain-pre-event-spot");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    expect(await loadChainAction("VALE3")).toEqual({ series: [], spot: null });
  });

  it("withholds a close that trails the calendar by more than the nightly ingestion lag", async () => {
    const email = uniqueEmail("chain-stale-spot");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    expect(await loadChainAction("BBAS3")).toEqual({ series: [], spot: null });
  });

  it("returns an empty chain for a malformed ticker", async () => {
    expect(await loadChainAction("not a ticker")).toEqual({ series: [], spot: null });
  });
});
