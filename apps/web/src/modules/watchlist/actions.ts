"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser, requireUser, UnauthenticatedError } from "@/modules/auth";
import { searchInstruments, type InstrumentSearchResult } from "@/modules/market-data";

import { WatchlistRepository } from "./watchlist-repository";

export type WatchlistActionResult = { status: "ok" } | { status: "error"; error: "invalid" };

const tickerInputSchema = z.strictObject({ ticker: tickerSchema });

const MAX_SEARCH_RESULTS = 20;
const searchInputSchema = z.strictObject({ query: z.string().max(20) });

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

  await withRepository((repository) => repository.add(parsed.data.ticker));
  revalidatePath("/");
  return { status: "ok" };
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
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/entrar");
    }
    throw error;
  }
  return searchInstruments(getDb(), parsed.data.query, MAX_SEARCH_RESULTS);
}
