"use server";

import { z } from "zod";
import { tickerPrefixQuerySchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import {
  searchOptionSeries,
  type OptionSeriesSearchResult,
} from "./repositories/option-repository";

const MAX_SEARCH_RESULTS = 20;
const SEARCH_RATE_LIMIT = { windowSeconds: 10, max: 30 };

const searchInputSchema = z.strictObject({ query: tickerPrefixQuerySchema });

export type SearchOptionSeriesResult =
  | { status: "ok"; results: OptionSeriesSearchResult[] }
  | { status: "error"; error: "rate_limited" };

// Reference data (ADR-0017), but behind a session and a per-account limit so
// the palette cannot become an anonymous query endpoint on the registry.
export async function searchOptionSeriesAction(input: {
  query: string;
}): Promise<SearchOptionSeriesResult> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "ok", results: [] };
  }
  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(
      getDb(),
      user.email,
      "market-data/series-search",
      SEARCH_RATE_LIMIT,
    );
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }
  const results = await searchOptionSeries(
    getDb(),
    parsed.data.query,
    todaySaoPauloDate(),
    MAX_SEARCH_RESULTS,
  );
  return { status: "ok", results };
}
