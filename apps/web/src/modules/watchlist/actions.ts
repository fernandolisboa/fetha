"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";
import {
  latestCandle,
  searchInstruments,
  type InstrumentSearchResult,
} from "@/modules/market-data";

import { WatchlistRepository } from "./watchlist-repository";

export type WatchlistActionResult =
  { status: "ok" } | { status: "error"; error: "invalid" | "cap" };

const tickerInputSchema = z.strictObject({ ticker: tickerSchema });

const MAX_SEARCH_RESULTS = 20;
const WATCHLIST_CAP = 100;
const SEARCH_RATE_LIMIT = { windowSeconds: 10, max: 30 };

// `%`, `_` and `\` are live `ILIKE` wildcards; a bare regex here (rather
// than deeper in the pattern-building code) rejects them before the query
// reaches the database at all, so a scan of every partition or a
// `PE_R4`-style probe of the instrument registry never has a live pattern
// to run.
const searchInputSchema = z.strictObject({ query: z.string().regex(/^[A-Za-z0-9]{1,12}$/) });

async function withRepository<T>(run: (repository: WatchlistRepository) => Promise<T>): Promise<T> {
  try {
    const repository = await forCurrentUser(getDb(), WatchlistRepository);
    return await run(repository);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
}

export async function addToWatchlistAction(input: {
  ticker: string;
}): Promise<WatchlistActionResult> {
  const parsed = tickerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  return withRepository(async (repository) => {
    const [existing, watchlistSize] = await Promise.all([
      latestCandle(getDb(), parsed.data.ticker),
      repository.count(),
    ]);
    if (!existing) {
      return { status: "error", error: "invalid" };
    }
    if (watchlistSize >= WATCHLIST_CAP) {
      return { status: "error", error: "cap" };
    }
    await repository.add(parsed.data.ticker);
    revalidatePath("/");
    return { status: "ok" };
  });
}

export async function removeFromWatchlistAction(input: {
  ticker: string;
}): Promise<WatchlistActionResult> {
  const parsed = tickerInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  await withRepository((repository) => repository.remove(parsed.data.ticker));
  revalidatePath("/");
  return { status: "ok" };
}

// Requires a session, not because the search result is user-scoped (it is
// reference data, ADR-0017), but so the combobox behind it cannot be used
// as an anonymous query endpoint against the instrument registry.
export async function searchInstrumentsAction(input: {
  query: string;
}): Promise<InstrumentSearchResult[]> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return [];
  }
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
  try {
    await enforceAccountRateLimit(getDb(), user.email, "watchlist/search", SEARCH_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return [];
    }
    throw error;
  }
  return searchInstruments(getDb(), parsed.data.query, MAX_SEARCH_RESULTS);
}
