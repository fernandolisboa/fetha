import { like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { optionSeries } from "./schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

const { searchOptionSeriesAction } = await import("./actions");

const PREFIX = `ZAS${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
const LIVE_TICKER = `${PREFIX}A40`;
const EXPIRED_TICKER = `${PREFIX}B40`;

function isRedirectError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
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

async function seedSeries(): Promise<void> {
  const base = { underlying: "PETR4", right: "put", strike: "32", style: "american" };
  await getDb()
    .insert(optionSeries)
    .values([
      {
        ...base,
        isin: `ZZ${PREFIX}LIVE`,
        ticker: LIVE_TICKER,
        expiry: "2099-12-18",
        asOf: new Date("2026-01-02T00:00:00Z"),
      },
      {
        ...base,
        isin: `ZZ${PREFIX}GONE`,
        ticker: EXPIRED_TICKER,
        expiry: "2001-01-15",
        asOf: new Date("2000-11-02T00:00:00Z"),
      },
    ]);
}

const createdEmails: string[] = [];

async function signIn(label: string): Promise<void> {
  const email = `fetha-market-data-actions-${label}-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  currentUser = await insertBareUser(email);
}

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  await db.delete(optionSeries).where(like(optionSeries.ticker, `${PREFIX}%`));
});

describe("searchOptionSeriesAction", () => {
  it("finds live series by ticker prefix for an authenticated caller", async () => {
    await signIn("ok");
    await seedSeries();

    const result = await searchOptionSeriesAction({ query: PREFIX });

    expect(result).toEqual({
      status: "ok",
      results: [
        {
          ticker: LIVE_TICKER,
          underlying: "PETR4",
          right: "put",
          strike: "32.00000000",
          expiry: "2099-12-18",
        },
      ],
    });
  });

  it("returns nothing for a query carrying a live LIKE wildcard", async () => {
    await signIn("wildcard");
    await seedSeries();

    expect(await searchOptionSeriesAction({ query: "%" })).toEqual({ status: "ok", results: [] });
    expect(await searchOptionSeriesAction({ query: `${PREFIX}_` })).toEqual({
      status: "ok",
      results: [],
    });
  });

  it("stops answering once the account rate limit is hit", async () => {
    await signIn("rate-limited");
    await seedSeries();

    type SearchResult = Awaited<ReturnType<typeof searchOptionSeriesAction>>;
    const outcomes: SearchResult[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      outcomes.push(await searchOptionSeriesAction({ query: PREFIX }));
    }

    for (const outcome of outcomes.slice(0, 30)) {
      expect(outcome.status).toBe("ok");
    }
    expect(outcomes[30]).toEqual({ status: "error", error: "rate_limited" });
  });

  it("redirects an unauthenticated caller", async () => {
    currentUser = null;

    let caught: unknown;
    try {
      await searchOptionSeriesAction({ query: PREFIX });
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
  });
});
