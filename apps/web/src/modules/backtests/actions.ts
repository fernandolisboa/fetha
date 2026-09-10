"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { centavosSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  UnauthenticatedError,
} from "@/modules/auth";
import { sessionByDate, sessionsBetween } from "@/modules/market-data";
import {
  StrategiesRepository,
  StrategyNotFoundError,
  StructuresRepository,
} from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { COST_MODEL_PRESETS, costModelPresetIds, defaultRiskProfile } from "./default-config";

export type CreateBacktestRunResult = {
  status: "error";
  error: "invalid" | "not_found" | "rate_limited";
};

const createInputSchema = z.strictObject({
  strategyId: z.string().min(1).max(200),
  strategyVersionId: z.string().min(1).max(200),
  universe: z.array(tickerSchema).min(1).max(50),
  from: sessionDateSchema,
  to: sessionDateSchema,
  initialCapital: centavosSchema.positive(),
  limits: z.enum(["enforce", "warn"]),
  costModel: z.enum(costModelPresetIds as [string, ...string[]]),
});

const CREATE_RATE_LIMIT = { windowSeconds: 60, max: 10 };
const MAX_SESSIONS_TIMES_UNIVERSE = 10_000 * 50;

// Signed 32-bit range: the column is a signed Postgres `integer`, while
// `crypto.getRandomValues(Uint32Array)` draws from the unsigned range, so
// about half of all draws overflowed it.
function randomSeed(): number {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  return value % 2_147_483_647;
}

export async function createBacktestRunAction(input: unknown): Promise<CreateBacktestRunResult> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid" };
  }
  if (parsed.data.from >= parsed.data.to) {
    return { status: "error", error: "invalid" };
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
    await enforceAccountRateLimit(getDb(), user.email, "backtests/create", CREATE_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }

  const db = getDb();

  // A `from` that never traded (weekend, holiday, before the calendar's
  // own start) must never silently produce a candle-less MarketView: the
  // engine would record `insufficient_data` for the whole run and still
  // reach `complete` with 0 operations. `to` is clamped to the last
  // session actually in range rather than rejected, since an end date in
  // the future is a common and harmless request ("run until today").
  const fromSession = await sessionByDate(db, parsed.data.from);
  if (!fromSession) {
    return { status: "error", error: "invalid" };
  }
  const rangeSessions = await sessionsBetween(db, parsed.data.from, parsed.data.to);
  const lastSession = rangeSessions.at(-1);
  if (!lastSession) {
    return { status: "error", error: "invalid" };
  }
  // Every chunk re-materialises the whole-period MarketView: bounding
  // sessions x universe at creation keeps a single run's data footprint
  // sane rather than letting the request body alone decide it.
  if (rangeSessions.length * parsed.data.universe.length > MAX_SESSIONS_TIMES_UNIVERSE) {
    return { status: "error", error: "invalid" };
  }
  const period = { from: parsed.data.from, to: lastSession.date };

  const watchlist = await new WatchlistRepository(db, user).list();
  const watchlistTickers = new Set(watchlist.map((item) => item.ticker));
  if (!parsed.data.universe.every((ticker) => watchlistTickers.has(ticker))) {
    return { status: "error", error: "invalid" };
  }

  const strategy = await new StrategiesRepository(db, user)
    .findMine(parsed.data.strategyId)
    .catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) return null;
      throw error;
    });
  const version = strategy?.versions.find((v) => v.id === parsed.data.strategyVersionId);
  if (!strategy || !version) {
    return { status: "error", error: "not_found" };
  }

  const structures = await new StructuresRepository(db).listAll();
  const structure = structures.find((candidate) => candidate.id === version.definition.structureId);
  if (!structure) {
    return { status: "error", error: "not_found" };
  }

  const run = await new BacktestRunRepository(db, user).create({
    strategyId: strategy.id,
    strategyVersionId: version.id,
    structure,
    universe: parsed.data.universe,
    period,
    initialCapital: parsed.data.initialCapital,
    costModel: COST_MODEL_PRESETS[parsed.data.costModel as keyof typeof COST_MODEL_PRESETS],
    riskProfile: defaultRiskProfile(parsed.data.initialCapital),
    limits: parsed.data.limits,
    sizing: version.definition.sizing,
    seed: randomSeed(),
  });

  redirect(`/estrategias/${strategy.id}/backtests/${run.id}`);
}
