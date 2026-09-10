import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ticker } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { candles } from "@/db/schema/market-data";
import { user } from "@/db/schema/auth";
import { deleteTestUser } from "@/db/test/cleanup";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { eq } from "drizzle-orm";

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

const { addToWatchlistAction, removeFromWatchlistAction, searchInstrumentsAction } =
  await import("./actions");
const { WatchlistRepository } = await import("./watchlist-repository");

const TICKER_A = "ACWL3" as Ticker;
const TICKER_B = "ACWM3" as Ticker;

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

function uniqueEmail(label: string): string {
  return `fetha-watchlist-actions-${label}-${crypto.randomUUID()}@example.com`;
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

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(candles).where(eq(candles.ticker, TICKER_A));
  await db.delete(candles).where(eq(candles.ticker, TICKER_B));
});

describe("addToWatchlistAction", () => {
  it("adds a valid ticker for the current user", async () => {
    const email = uniqueEmail("add-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await addToWatchlistAction({ ticker: TICKER_A });

    expect(result).toEqual({ status: "ok" });
    const repository = new WatchlistRepository(getDb(), currentUser);
    expect((await repository.list()).map((item) => item.ticker)).toEqual([TICKER_A]);
  });

  it("rejects a malformed ticker", async () => {
    const email = uniqueEmail("add-invalid");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await addToWatchlistAction({ ticker: "not a ticker" });

    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("redirects an unauthenticated caller instead of writing anything", async () => {
    currentUser = null;

    let caught: unknown;
    try {
      await addToWatchlistAction({ ticker: TICKER_A });
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
  });
});

describe("removeFromWatchlistAction", () => {
  it("removes a ticker the current user added", async () => {
    const email = uniqueEmail("remove-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await new WatchlistRepository(getDb(), currentUser).add(TICKER_A);

    const result = await removeFromWatchlistAction({ ticker: TICKER_A });

    expect(result).toEqual({ status: "ok" });
    const repository = new WatchlistRepository(getDb(), currentUser);
    expect(await repository.list()).toEqual([]);
  });
});

describe("searchInstrumentsAction", () => {
  it("finds instruments by ticker prefix for an authenticated caller", async () => {
    const email = uniqueEmail("search-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await upsertDailyCandles(getDb(), "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: "2026-05-11",
        ticker: TICKER_A,
        open: "10.000000",
        high: "11.000000",
        low: "9.000000",
        average: "10.500000",
        close: "10.750000",
        trades: 100,
        tradedQuantity: 5000,
      }),
    ]);

    const results = await searchInstrumentsAction({ query: "ACWL" });

    expect(results.map((result) => result.ticker)).toEqual([TICKER_A]);
  });

  it("redirects an unauthenticated caller", async () => {
    currentUser = null;

    let caught: unknown;
    try {
      await searchInstrumentsAction({ query: "ACWL" });
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
  });
});
