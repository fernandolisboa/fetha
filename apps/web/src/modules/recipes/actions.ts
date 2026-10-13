"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  leftOpenUnitIntervalSchema,
  sessionDateSchema,
  tickerSchema,
  type SessionDate,
  type StrategyDefinition,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";
import {
  DEFAULT_WALK_FORWARD_WINDOW,
  reportHref,
  startBacktestRun,
  type StartBacktestRunError,
} from "@/modules/backtests";
import { candleSessionBoundsInRange } from "@/modules/market-data";
import { getCurrentRiskProfile } from "@/modules/portfolio";
import {
  createStrategyAction,
  getMyStrategy,
  recipeById,
  type StrategyActionResult,
} from "@/modules/strategies";
import { addToWatchlistAction, WatchlistRepository } from "@/modules/watchlist";

import { recipeRiskFractions, type RecipeRiskFraction } from "./risk";
import { t } from "./strings";

export type StartRecipeError =
  | "invalid"
  | "no_risk_profile"
  | "no_data"
  | "watchlist_full"
  | "rate_limited"
  | "limit_reached"
  | "too_many_active"
  | "unavailable";

export type StartRecipeResult = {
  status: "error";
  error: StartRecipeError;
  strategyId?: string;
};

type StartRecipeOutcome = { status: "ok"; strategyId: string; runId: string } | StartRecipeResult;

const inputSchema = z.strictObject({
  recipeId: z.string().min(1).max(100),
  ticker: tickerSchema,
  riskFraction: z.enum(recipeRiskFractions),
});

// docs/adr/0064: two years is long enough to hold a few expiries of every
// recipe and short enough for one chunk on one ticker.
const RECIPE_BACKTEST_YEARS = 2;

function yearsBefore(date: SessionDate, years: number): SessionDate {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCFullYear(shifted.getUTCFullYear() - years);
  return sessionDateSchema.parse(shifted.toISOString().slice(0, 10));
}

function strategyErrorOf(
  error: Extract<StrategyActionResult, { status: "error" }>["error"],
): StartRecipeError {
  switch (error) {
    case "rate_limited":
    case "limit_reached":
    case "unavailable":
      return error;
    case "invalid":
    case "not_found":
    case "not_shared":
    case "conflict":
    case "version_limit":
    case "archived":
      return "invalid";
  }
}

function runErrorOf(error: StartBacktestRunError): StartRecipeError {
  switch (error) {
    case "rate_limited":
    case "too_many_active":
    case "no_risk_profile":
      return error;
    case "invalid":
    case "not_found":
    case "archived":
      return "invalid";
  }
}

export async function startRecipeAction(input: unknown): Promise<StartRecipeResult> {
  const parsed = inputSchema.safeParse(input);
  const recipe = parsed.success ? recipeById(parsed.data.recipeId) : null;
  if (!parsed.success || !recipe) {
    return { status: "error", error: "invalid" };
  }

  const outcome = await withAuthenticatedAction(() =>
    startRecipe(recipe.definition, parsed.data.ticker, parsed.data.riskFraction),
  );
  if (outcome.status === "error") {
    return outcome;
  }
  redirect(reportHref(outcome.strategyId, outcome.runId, { autoRun: true }));
}

async function startRecipe(
  recipeDefinition: StrategyDefinition,
  ticker: Ticker,
  riskFraction: RecipeRiskFraction,
): Promise<StartRecipeOutcome> {
  const riskProfile = await getCurrentRiskProfile();
  if (!riskProfile) {
    return { status: "error", error: "no_risk_profile" };
  }

  const to = todaySaoPauloDate();
  const from = yearsBefore(to, RECIPE_BACKTEST_YEARS);
  // Checked before anything is written: a ticker with no candle in the window
  // can never start a run, and each retry would leave another strategy.
  if (!(await candleSessionBoundsInRange(getDb(), [ticker], { from, to }))) {
    return { status: "error", error: "no_data" };
  }

  const watchlist = await (await forCurrentUser(getDb(), WatchlistRepository)).list();
  if (!watchlist.some((item) => item.ticker === ticker)) {
    const added = await addToWatchlistAction({ ticker });
    if (added.status === "error") {
      return { status: "error", error: added.error === "cap" ? "watchlist_full" : "no_data" };
    }
  }

  const definition: StrategyDefinition = {
    ...recipeDefinition,
    name: t.strategyName.replace("{structure}", recipeDefinition.name).replace("{ticker}", ticker),
    sizing: { kind: "fixed_risk", fraction: leftOpenUnitIntervalSchema.parse(riskFraction) },
  };
  const created = await createStrategyAction({ definition });
  if (created.status === "error") {
    return { status: "error", error: strategyErrorOf(created.error) };
  }
  const strategyId = created.strategyId;

  const strategy = await getMyStrategy(strategyId);
  const version = strategy.versions[0];
  if (!version) {
    return { status: "error", error: "invalid", strategyId };
  }

  const run = await startBacktestRun({
    strategyId,
    strategyVersionId: version.id,
    universe: [ticker],
    from,
    to,
    initialCapital: riskProfile.declaredCapital,
    limits: "warn",
    costModel: "b3_default",
    walkForwardWindowSessions: DEFAULT_WALK_FORWARD_WINDOW,
  });
  if (run.status === "error") {
    return { status: "error", error: runErrorOf(run.error), strategyId };
  }
  return { status: "ok", strategyId, runId: run.runId };
}
