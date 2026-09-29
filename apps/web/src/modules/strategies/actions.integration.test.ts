import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import type { DecimalString, StrategyDefinition } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { strategies, structures } from "./schema";
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

const {
  addStrategyVersionAction,
  archiveStrategyAction,
  copySharedStrategyAction,
  createStrategyAction,
  unarchiveStrategyAction,
} = await import("./actions");
const { MAX_STRATEGIES_PER_USER, StrategiesRepository } = await import("./strategies-repository");

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
    .values([
      {
        id: "stock",
        name: "Compra de ação",
        legs: [{ role: "stock", side: "buy", ratio: 1 }],
      },
      {
        id: "long-call-actions-test",
        name: "Compra de call",
        legs: [{ role: "call", side: "buy", ratio: 1, strikeRank: 1 }],
      },
    ])
    .onConflictDoNothing();
});

const createdEmails: string[] = [];

afterAll(async () => {
  await getDb().delete(structures).where(eq(structures.id, "long-call-actions-test"));
});

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

  it("rejects an indicator length above the bound and persists nothing (#249)", async () => {
    const email = uniqueEmail("create-length-bound");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await createStrategyAction({
      definition: definition({
        entry: {
          kind: "compare",
          left: { kind: "indicator", indicator: { kind: "ema", length: 501 } },
          comparator: ">",
          right: { kind: "price", field: "close" },
        },
      }),
    });

    expect(result).toEqual({ status: "error", error: "invalid" });

    const repository = new StrategiesRepository(getDb(), currentUser);
    expect(await repository.listMine()).toEqual([]);
  });

  it("rejects an indicator above the bound in a roll adjustment's trigger (#249)", async () => {
    const email = uniqueEmail("create-roll-bound");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const strikes = [{ kind: "delta" as const, target: decimalString("0.3") }];
    const expiry = { kind: "business_days" as const, min: 5, max: 20 };
    const optionDefinition = (length: number) =>
      definition({
        structureId: "long-call-actions-test",
        strikes,
        expiry,
        adjustments: [
          {
            kind: "roll",
            when: {
              kind: "condition",
              condition: {
                kind: "compare",
                left: { kind: "indicator", indicator: { kind: "rsi", length } },
                comparator: "<",
                right: { kind: "constant", value: decimalString("30") },
              },
            },
            expiry,
            strikes,
          },
        ],
      });

    const refused = await createStrategyAction({ definition: optionDefinition(501) });
    expect(refused).toEqual({ status: "error", error: "invalid" });
    const repository = new StrategiesRepository(getDb(), currentUser);
    expect(await repository.listMine()).toEqual([]);

    const accepted = await createStrategyAction({ definition: optionDefinition(500) });
    expect(accepted.status).toBe("ok");
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

  it("rejects an iv_rank lookback above the bound, while a stored version above it stays readable (#249)", async () => {
    const email = uniqueEmail("add-version-lookback-bound");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const repository = new StrategiesRepository(getDb(), currentUser);
    const stored = await repository.createWithVersion(
      definition({
        entry: {
          kind: "compare",
          left: { kind: "indicator", indicator: { kind: "rsi", length: 100_000 } },
          comparator: "<",
          right: { kind: "constant", value: decimalString("30") },
        },
      }),
    );

    const result = await addStrategyVersionAction({
      strategyId: stored.id,
      definition: definition({
        name: "V2",
        entry: {
          kind: "compare",
          left: { kind: "indicator", indicator: { kind: "iv_rank", lookbackSessions: 1261 } },
          comparator: ">",
          right: { kind: "constant", value: decimalString("50") },
        },
      }),
    });

    expect(result).toEqual({ status: "error", error: "invalid" });
    const found = await repository.findMine(stored.id);
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

  it("refuses addVersion on an archived strategy", async () => {
    const email = uniqueEmail("add-version-archived");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");
    await archiveStrategyAction({ strategyId: created.strategyId });

    const result = await addStrategyVersionAction({
      strategyId: created.strategyId,
      definition: definition({ name: "V2" }),
    });
    expect(result).toEqual({ status: "error", error: "archived" });
  });
});

describe("archiveStrategyAction / unarchiveStrategyAction (#170, docs/adr/0043)", () => {
  it("archives a strategy and reports not found for another user's strategy", async () => {
    const emailOwner = uniqueEmail("archive-action-owner");
    const emailOther = uniqueEmail("archive-action-other");
    createdEmails.push(emailOwner, emailOther);
    const owner = await insertBareUser(emailOwner);
    currentUser = owner;

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");

    const other = await insertBareUser(emailOther);
    currentUser = other;
    const asOther = await archiveStrategyAction({ strategyId: created.strategyId });
    expect(asOther).toEqual({ status: "error", error: "not_found" });

    currentUser = owner;
    const result = await archiveStrategyAction({ strategyId: created.strategyId });
    expect(result).toEqual({ status: "ok" });

    const repository = new StrategiesRepository(getDb(), owner);
    expect((await repository.listMine()).map((s) => s.id)).not.toContain(created.strategyId);
  });

  it("unarchives a strategy back into listMine", async () => {
    const email = uniqueEmail("unarchive-action");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");

    await archiveStrategyAction({ strategyId: created.strategyId });
    const result = await unarchiveStrategyAction({ strategyId: created.strategyId });
    expect(result).toEqual({ status: "ok" });

    const repository = new StrategiesRepository(getDb(), currentUser);
    expect((await repository.listMine()).map((s) => s.id)).toContain(created.strategyId);
  });

  it("reports limit_reached when unarchiving would put the user over the cap", async () => {
    const email = uniqueEmail("unarchive-action-limit");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;

    const created = await createStrategyAction({ definition: definition() });
    if (created.status !== "ok") throw new Error("setup failed");
    await archiveStrategyAction({ strategyId: created.strategyId });

    await getDb()
      .insert(strategies)
      .values(
        Array.from({ length: MAX_STRATEGIES_PER_USER }, (_, index) => ({
          userId: owner.id,
          name: `Bulk ${String(index)}`,
          visibility: "private" as const,
        })),
      );

    const result = await unarchiveStrategyAction({ strategyId: created.strategyId });
    expect(result).toEqual({ status: "error", error: "limit_reached" });
  });

  it("reports limit_reached, not unavailable, when create or copy hits the cap (#227)", async () => {
    const sharerEmail = uniqueEmail("cap-sharer");
    const email = uniqueEmail("cap-create-copy");
    createdEmails.push(sharerEmail, email);

    currentUser = await insertBareUser(sharerEmail);
    const shared = await createStrategyAction({ definition: definition() });
    if (shared.status !== "ok") throw new Error("setup failed");
    await new StrategiesRepository(getDb(), currentUser).setVisibility(shared.strategyId, "shared");

    const owner = await insertBareUser(email);
    currentUser = owner;
    await getDb()
      .insert(strategies)
      .values(
        Array.from({ length: MAX_STRATEGIES_PER_USER }, (_, index) => ({
          userId: owner.id,
          name: `Bulk ${String(index)}`,
          visibility: "private" as const,
        })),
      );

    expect(await createStrategyAction({ definition: definition() })).toEqual({
      status: "error",
      error: "limit_reached",
    });
    expect(await copySharedStrategyAction({ sourceStrategyId: shared.strategyId })).toEqual({
      status: "error",
      error: "limit_reached",
    });
  });
});

describe("strategy write rate limit (#217, docs/adr/0043)", () => {
  it("bounds a create → archive loop: the 21st write in the window is rate_limited, whichever action it is", async () => {
    const email = uniqueEmail("write-rate-limit");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const created = await createStrategyAction({ definition: definition() });
      if (created.status !== "ok") throw new Error("setup failed");
      expect(await archiveStrategyAction({ strategyId: created.strategyId })).toEqual({
        status: "ok",
      });
    }

    expect(await createStrategyAction({ definition: definition() })).toEqual({
      status: "error",
      error: "rate_limited",
    });
    expect(await archiveStrategyAction({ strategyId: "does-not-matter" })).toEqual({
      status: "error",
      error: "rate_limited",
    });
    expect(await unarchiveStrategyAction({ strategyId: "does-not-matter" })).toEqual({
      status: "error",
      error: "rate_limited",
    });
    expect(await copySharedStrategyAction({ sourceStrategyId: "does-not-matter" })).toEqual({
      status: "error",
      error: "rate_limited",
    });
  });

  it("counts each user separately", async () => {
    const emailBusy = uniqueEmail("write-rate-limit-busy");
    const emailOther = uniqueEmail("write-rate-limit-other");
    createdEmails.push(emailBusy, emailOther);
    currentUser = await insertBareUser(emailBusy);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await archiveStrategyAction({ strategyId: "does-not-matter" });
    }
    expect(await archiveStrategyAction({ strategyId: "does-not-matter" })).toEqual({
      status: "error",
      error: "rate_limited",
    });

    currentUser = await insertBareUser(emailOther);
    expect(await createStrategyAction({ definition: definition() })).toMatchObject({
      status: "ok",
    });
  });
});
