"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";

import { BacktestRunNotFoundError, BacktestRunRepository } from "./backtest-run-repository";
import { reportHref } from "./report-href";
import {
  startBacktestRun,
  startBacktestRunInputSchema,
  type StartBacktestRunError,
} from "./start-run";

export type CreateBacktestRunResult = {
  status: "error";
  error: StartBacktestRunError;
};

export async function createBacktestRunAction(input: unknown): Promise<CreateBacktestRunResult> {
  const parsed = startBacktestRunInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }

  const result = await withAuthenticatedAction(() => startBacktestRun(parsed.data));
  if (result.status === "error") {
    return result;
  }
  redirect(reportHref(result.strategyId, result.runId));
}

export type DiscardBacktestRunActionResult =
  { status: "ok" } | { status: "error"; error: "not_found" | "not_discardable" | "rate_limited" };

const discardInputSchema = z.strictObject({ runId: z.string().min(1).max(200) });

// Mirrors CREATE_RATE_LIMIT's own bucket, keyed separately ("backtests/discard"):
// discard is cheap compared to a create, but an unbounded loop of it would
// still be an unbounded write loop against the same table.
const DISCARD_RATE_LIMIT = { windowSeconds: 60, max: 10 };

export async function discardBacktestRunAction(
  input: unknown,
): Promise<DiscardBacktestRunActionResult> {
  const parsed = discardInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "not_found" };
  }

  try {
    return await withAuthenticatedAction(async () => {
      const user = await requireUser();
      const db = getDb();
      try {
        await enforceAccountRateLimit(db, user.email, "backtests/discard", DISCARD_RATE_LIMIT);
      } catch (error) {
        if (error instanceof AccountRateLimitExceededError) {
          return { status: "error", error: "rate_limited" };
        }
        throw error;
      }
      const repository = new BacktestRunRepository(db, user);
      const result = await repository.discard(parsed.data.runId);
      revalidatePath("/estrategias");
      if (result.status === "not_discardable") {
        return { status: "error", error: "not_discardable" };
      }
      revalidatePath(`/estrategias/${result.run.strategyId}`);
      revalidatePath(`/estrategias/${result.run.strategyId}/backtests/${result.run.id}`);
      return { status: "ok" };
    });
  } catch (error) {
    if (error instanceof BacktestRunNotFoundError) {
      return { status: "error", error: "not_found" };
    }
    throw error;
  }
}
