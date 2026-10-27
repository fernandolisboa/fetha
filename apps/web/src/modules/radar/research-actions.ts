"use server";

import { getDb } from "@/db/client";
import { postgresErrorOf } from "@/db/pg-error";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { getMyRiskContext } from "@/modules/portfolio";

import { researchSuggestions, type ResearchResult } from "./research";

const RESEARCH_RATE_LIMIT = { windowSeconds: 60, max: 6 };
// The first of two budgets the page's `maxDuration` (180 s, app/(shell)/page.tsx) holds: this one,
// then the model call (docs/adr/0076).
const RESEARCH_BUDGET_MS = 45_000;

export type ResearchSuggestionsActionResult =
  | { status: "ok"; result: ResearchResult }
  | { status: "error"; error: "rate_limited" | "unavailable" };

export async function researchSuggestionsAction(): Promise<ResearchSuggestionsActionResult> {
  const user = await withAuthenticatedAction(() => requireUser());
  const deadlineAt = Date.now() + RESEARCH_BUDGET_MS;
  try {
    await enforceAccountRateLimit(getDb(), user.email, "radar/research", RESEARCH_RATE_LIMIT);
    const context = await withAuthenticatedAction(() => getMyRiskContext());
    const result = await researchSuggestions(getDb(), { ...context, now: new Date(), deadlineAt });
    return { status: "ok", result };
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    if (postgresErrorOf(error)) {
      return { status: "error", error: "unavailable" };
    }
    throw error;
  }
}
