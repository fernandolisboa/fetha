import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import { decimalStringSchema, tickerSchema, type Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedOperation, seedOptionSeries } from "@/db/test/held-operation";
import { nowInstant } from "@/lib/instant";
import { user } from "@/modules/auth/schema";
import { holdingKey } from "./bookkeeping";
import { planOperation } from "./operation-plan";
import { PortfolioRepository, type PlanFromFills } from "./portfolio-repository";

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

const { getMyHeldOperation, getMyOpenOperationExpiries, heldOperationForScoring } =
  await import("./held-operations");

const createdEmails: string[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<CurrentUser> {
  const email = `fetha-held-operations-${label}-${crypto.randomUUID()}@example.com`;
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
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function randomTicker(prefix: string): Ticker {
  return tickerSchema.parse(
    `${prefix}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`,
  );
}

const EXPIRY = "2031-06-20";

async function coveredCall(owner: CurrentUser, buyBack: boolean): Promise<string> {
  const underlying = randomTicker("HO");
  const call = randomTicker("HC");
  cleanups.push(
    await seedOptionSeries(getDb(), {
      ticker: call,
      underlying,
      right: "call",
      strike: "32.00000000",
      expiry: EXPIRY,
      listedOn: "2031-06-02",
    }),
  );
  const { operationId } = await seedOperation(getDb(), owner, [
    { ticker: underlying, side: "buy", quantity: 100, price: "30", session: "2031-06-02" },
    {
      ticker: call,
      expiry: EXPIRY,
      side: "sell",
      quantity: 100,
      price: "1",
      session: "2031-06-02",
    },
    ...(buyBack
      ? [
          {
            ticker: call,
            expiry: EXPIRY,
            side: "buy" as const,
            quantity: 100,
            price: "0.20",
            session: "2031-06-05",
          },
        ]
      : []),
  ]);
  return operationId;
}

describe("getMyOpenOperationExpiries", () => {
  it("reads the expiry of an operation whose option leg is still open", async () => {
    const owner = await insertUser("live");
    const operationId = await coveredCall(owner, false);

    currentUser = owner;
    expect(await getMyOpenOperationExpiries([operationId])).toEqual(
      new Map([[operationId, EXPIRY]]),
    );
  });

  it("reads no expiry for the stock left after its call was bought back (#259)", async () => {
    const owner = await insertUser("remainder");
    const operationId = await coveredCall(owner, true);

    currentUser = owner;
    expect(await getMyOpenOperationExpiries([operationId])).toEqual(new Map([[operationId, null]]));
    expect(await getMyHeldOperation(operationId)).toMatchObject({
      expiry: null,
      legs: [{ role: "stock", quantity: 100 }],
    });
  });

  it("user A reads nothing of user B's open operations", async () => {
    const [a, b] = await Promise.all([insertUser("iso-a"), insertUser("iso-b")]);
    const operationId = await coveredCall(b, false);

    currentUser = a;
    expect(await getMyOpenOperationExpiries([operationId])).toEqual(new Map());
    expect(await getMyOpenOperationExpiries([])).toEqual(new Map());
  });
});

describe("heldOperationForScoring", () => {
  it("scores a decision on a covered call rolled since, including its stock leg (#382)", async () => {
    const owner = await insertUser("scoring-roll");
    const underlying = randomTicker("HR");
    const call = randomTicker("HC");
    const nextCall = randomTicker("HN");
    const NEXT_EXPIRY = "2031-07-18";
    cleanups.push(
      await seedOptionSeries(getDb(), {
        ticker: call,
        underlying,
        right: "call",
        strike: "32.00000000",
        expiry: EXPIRY,
        listedOn: "2031-06-02",
      }),
    );
    cleanups.push(
      await seedOptionSeries(getDb(), {
        ticker: nextCall,
        underlying,
        right: "call",
        strike: "33.00000000",
        expiry: NEXT_EXPIRY,
        listedOn: "2031-06-02",
      }),
    );

    const { operationId, fillIds } = await seedOperation(getDb(), owner, [
      { ticker: underlying, side: "buy", quantity: 100, price: "30", session: "2031-06-02" },
      {
        ticker: call,
        expiry: EXPIRY,
        side: "sell",
        quantity: 100,
        price: "1",
        session: "2031-06-02",
      },
    ]);

    const series = new Map([
      [
        holdingKey(call, EXPIRY),
        { underlying, right: "call" as const, strike: "32.00000000", expiry: EXPIRY },
      ],
      [
        holdingKey(nextCall, NEXT_EXPIRY),
        { underlying, right: "call" as const, strike: "33.00000000", expiry: NEXT_EXPIRY },
      ],
    ]);
    const plan: PlanFromFills = (records) => {
      const planned = planOperation(records, series);
      if (!planned.ok) return planned;
      const { underlying: planUnderlying, expiry, openedAt, status, closedAt } = planned.state;
      return {
        ok: true,
        state: { underlying: planUnderlying, expiry, openedAt, status, closedAt },
      };
    };

    const repository = new PortfolioRepository(getDb(), owner);
    const result = await repository.roll(
      operationId,
      fillIds,
      [
        {
          ticker: call,
          assetClass: "option",
          side: "buy",
          quantity: 100,
          price: decimalStringSchema.parse("0.20"),
          session: "2031-06-05",
          costsCentavos: 0,
          expiry: EXPIRY,
          source: "manual",
          importKey: null,
        },
      ],
      [
        {
          ticker: nextCall,
          assetClass: "option",
          side: "sell",
          quantity: 100,
          price: decimalStringSchema.parse("1.50"),
          session: "2031-06-05",
          costsCentavos: 0,
          expiry: NEXT_EXPIRY,
          source: "manual",
          importKey: null,
        },
      ],
      "2031-06-05",
      plan,
    );
    if (!result.ok) throw new Error(`test setup: roll failed (${result.reason})`);

    currentUser = owner;
    // Decided before the roll (#382), on the position's own fills at that moment: the stock and
    // the original short call. The decision's own `heldFillIds` names them regardless of the
    // stock fill carrying forward onto the new (rolled) operation's own id afterward.
    const decidedAt = nowInstant(new Date("2031-06-10T20:00:00.000Z"));
    const scored = await heldOperationForScoring(getDb(), owner, {
      operationId,
      heldFillIds: fillIds,
      decidedAt,
      horizonClose: decidedAt,
    });

    expect(scored).toMatchObject({
      ok: true,
      operation: { underlying, legs: [{ role: "stock", quantity: 100 }] },
    });
  });

  it("user B cannot score user A's held operation", async () => {
    const [a, b] = await Promise.all([insertUser("scoring-iso-a"), insertUser("scoring-iso-b")]);
    const operationId = await coveredCall(a, false);
    const scored = await heldOperationForScoring(getDb(), b, {
      operationId,
      heldFillIds: [],
      decidedAt: nowInstant(),
      horizonClose: nowInstant(),
    });
    expect(scored).toEqual({ ok: false, reason: "operation_not_found" });
  });
});
