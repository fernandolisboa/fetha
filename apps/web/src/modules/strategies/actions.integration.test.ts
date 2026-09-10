import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

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
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { addStrategyVersionAction, createStrategyAction } = await import("./actions");
const { StrategiesRepository } = await import("./strategies-repository");

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

function uniqueEmail(label: string): string {
  return `fetha-strategy-actions-${label}-${crypto.randomUUID()}@example.com`;
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

function definition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
  return {
    name: "SMA cruza acima",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
      comparator: ">",
      right: { kind: "price", field: "close" },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
    exit: [],
    adjustments: [],
    ...overrides,
  };
}

beforeAll(async () => {
  await getDb()
    .insert(structures)
    .values({
      id: "stock",
      name: "Compra de ação",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    })
    .onConflictDoNothing();
});

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("createStrategyAction", () => {
  it("rejects an incoherent definition (stock structure with strikes) and persists nothing", async () => {
    const email = uniqueEmail("create-incoherent");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await createStrategyAction({
      definition: definition({
        strikes: [{ kind: "delta", target: decimalString("0.3") }],
        expiry: { kind: "business_days", min: 5, max: 20 },
      }),
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    const repository = new StrategiesRepository(getDb(), currentUser);
    expect(await repository.listMine()).toEqual([]);
  });

  it("rejects an unknown structureId and persists nothing", async () => {
    const email = uniqueEmail("create-unknown-structure");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await createStrategyAction({
      definition: definition({ structureId: "does-not-exist" }),
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    const repository = new StrategiesRepository(getDb(), currentUser);
    expect(await repository.listMine()).toEqual([]);
  });

  it("creates a coherent stock-only definition", async () => {
    const email = uniqueEmail("create-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await createStrategyAction({ definition: definition() });

    expect(result.status).toBe("ok");
  });

  it("resolves the session before running the coherence query: an unauthenticated caller is redirected, not told the definition is invalid", async () => {
    currentUser = null;

    let caught: unknown;
    try {
      await createStrategyAction({
        definition: definition({
          strikes: [{ kind: "delta", target: decimalString("0.3") }],
          expiry: { kind: "business_days", min: 5, max: 20 },
        }),
      });
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
  });
});

describe("addStrategyVersionAction", () => {
  it("rejects an incoherent definition and leaves the previous version as the latest", async () => {
    const email = uniqueEmail("add-version-incoherent");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");

    const result = await addStrategyVersionAction({
      strategyId: created.strategyId,
      definition: definition({
        name: "V2",
        strikes: [{ kind: "delta", target: decimalString("0.3") }],
        expiry: { kind: "business_days", min: 5, max: 20 },
      }),
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    const repository = new StrategiesRepository(getDb(), currentUser);
    const found = await repository.findMine(created.strategyId);
    expect(found.versions).toHaveLength(1);
  });

  it("resolves the session before running the coherence query: an unauthenticated caller is redirected, not told the definition is invalid", async () => {
    const email = uniqueEmail("add-version-session-order");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");

    currentUser = null;

    let caught: unknown;
    try {
      await addStrategyVersionAction({
        strategyId: created.strategyId,
        definition: definition({
          name: "V2",
          strikes: [{ kind: "delta", target: decimalString("0.3") }],
          expiry: { kind: "business_days", min: 5, max: 20 },
        }),
      });
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
  });
});
