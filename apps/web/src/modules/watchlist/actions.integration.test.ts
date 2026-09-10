import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ticker } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { candles } from "@/db/schema/market-data";
import { user } from "@/db/schema/auth";
import { watchlistItems } from "@/db/schema/watchlist";
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
const CAP_TICKERS = Array.from(
  { length: 101 },
  (_, index) => `CAP${String(index).padStart(4, "0")}`,
);

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

function stockRow(ticker: string) {
  return cotahistStockRowSchema.parse({
    kind: "stock",
    session: "2026-05-11",
    ticker,
    open: "10.000000",
    high: "11.000000",
    low: "9.000000",
    average: "10.500000",
    close: "10.750000",
    trades: 100,
    tradedQuantity: 5000,
  });
}

async function upsertCandle(ticker: string): Promise<void> {
  await upsertDailyCandles(getDb(), "2026-05-11", new Date("2026-05-11T21:00:00.000Z"), [
    stockRow(ticker),
  ]);
}

async function upsertCandles(tickers: string[]): Promise<void> {
  await upsertDailyCandles(
    getDb(),
    "2026-05-11",
    new Date("2026-05-11T21:00:00.000Z"),
    tickers.map(stockRow),
  );
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
  await db.delete(candles).where(inArray(candles.ticker, CAP_TICKERS));
});

describe("addToWatchlistAction", () => {
  it("adds a valid, ingested ticker for the current user", async () => {
    const email = uniqueEmail("add-ok");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await upsertCandle(TICKER_A);

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

  it("rejects a well-formed ticker with no ingested candles", async () => {
    const email = uniqueEmail("add-unknown");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);

    const result = await addToWatchlistAction({ ticker: "NADA3" });

    expect(result).toEqual({ status: "error", error: "invalid" });
    const repository = new WatchlistRepository(getDb(), currentUser);
    expect(await repository.list()).toEqual([]);
  });

  it("rejects adding a 101st instrument once the watchlist is at its cap", async () => {
    const email = uniqueEmail("add-cap");
    createdEmails.push(email);
    const owner = await insertBareUser(email);
    currentUser = owner;
    const [overflowTicker, ...capTickers] = CAP_TICKERS;
    if (!overflowTicker || capTickers.length !== 100) {
      throw new Error("test setup: expected 100 tickers at cap plus one overflow ticker");
    }
    await upsertCandles(CAP_TICKERS);
    await getDb()
      .insert(watchlistItems)
      .values(capTickers.map((ticker) => ({ userId: owner.id, ticker })));
    const repository = new WatchlistRepository(getDb(), owner);

    const result = await addToWatchlistAction({ ticker: overflowTicker });

    expect(result).toEqual({ status: "error", error: "cap" });
    expect(await repository.list()).toHaveLength(100);
  }, 30_000);

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
    await upsertCandle(TICKER_A);

    const results = await searchInstrumentsAction({ query: "ACWL" });

    expect(results.map((result) => result.ticker)).toEqual([TICKER_A]);
  });

  it("returns nothing for a query carrying a live ILIKE wildcard", async () => {
    const email = uniqueEmail("search-wildcard");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await upsertCandle(TICKER_A);

    const results = await searchInstrumentsAction({ query: "%" });

    expect(results).toEqual([]);
  });

  it("stops answering once the account rate limit is hit", async () => {
    const email = uniqueEmail("search-rate-limited");
    createdEmails.push(email);
    currentUser = await insertBareUser(email);
    await upsertCandle(TICKER_A);

    type SearchResults = Awaited<ReturnType<typeof searchInstrumentsAction>>;
    const outcomes: SearchResults[] = [];
    for (let attempt = 0; attempt < 35; attempt += 1) {
      outcomes.push(await searchInstrumentsAction({ query: "ACWL" }));
    }

    expect(outcomes.some((outcome) => outcome.length === 0)).toBe(true);
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
