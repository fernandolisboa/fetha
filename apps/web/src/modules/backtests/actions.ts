"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { centavosSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { hasCandlesInRange, sessionByDate, sessionsBetween } from "@/modules/market-data";
import { getCurrentRiskProfile } from "@/modules/portfolio";
import { StrategiesRepository, StrategyNotFoundError } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { COST_MODEL_PRESETS, costModelPresetIds } from "./default-config";
import { resolveStructure, StructureNotFoundError } from "./run-chunk";

export type CreateBacktestRunResult = {
  status: "error";
  error: "invalid" | "not_found" | "rate_limited" | "no_risk_profile";
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
// `10_000 * 50` (a full ~40-year B3 calendar x the universe ceiling) is
// above anything the calendar has ever actually been ingested to, so it
// never fires (round 2 item 17). Every chunk re-materialises the *whole*
// MarketView on every call regardless of how many sessions it then
// simulates (run-chunk.ts), so the real constraint is what one such call
// can load and index before its own wall-clock budget: measured (round 2
// item 18) at ~23.5s for 250 sessions x 50 tickers (12,500 candles) against
// a 240s per-chunk budget, i.e. roughly 8-10x headroom before that budget
// itself would be the failure mode. 100,000 stays comfortably under that
// measured capacity with margin, while still being small enough that a
// realistic multi-year, near-full-universe request can actually hit it.
const MAX_SESSIONS_TIMES_UNIVERSE = 100_000;

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

  return withAuthenticatedAction(() => createBacktestRun(parsed.data));
}

async function createBacktestRun(
  parsed: z.infer<typeof createInputSchema>,
): Promise<CreateBacktestRunResult> {
  const user = await requireUser();

  try {
    await enforceAccountRateLimit(getDb(), user.email, "backtests/create", CREATE_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { status: "error", error: "rate_limited" };
    }
    throw error;
  }

  const db = getDb();

  // A run's limits are the user's own declared RiskProfile (portfolio module,
  // CONTEXT.md), never a fabricated unconstrained one: a run created before
  // any profile is declared is refused rather than silently running with
  // limits that can never breach, which would make the "Enforce / Warn only"
  // control unable to change any outcome.
  const riskProfile = await getCurrentRiskProfile();
  if (!riskProfile) {
    return { status: "error", error: "no_risk_profile" };
  }

  // A `from` that never traded (weekend, holiday, before the calendar's
  // own start) must never silently produce a candle-less MarketView: the
  // engine would record `insufficient_data` for the whole run and still
  // reach `complete` with 0 operations. `to` is clamped to the last
  // session actually in range rather than rejected, since an end date in
  // the future is a common and harmless request ("run until today").
  const fromSession = await sessionByDate(db, parsed.from);
  if (!fromSession) {
    return { status: "error", error: "invalid" };
  }
  const rangeSessions = await sessionsBetween(db, parsed.from, parsed.to);
  const lastSession = rangeSessions.at(-1);
  if (!lastSession) {
    return { status: "error", error: "invalid" };
  }
  // Every chunk re-materialises the whole-period MarketView: bounding
  // sessions x universe at creation keeps a single run's data footprint
  // sane rather than letting the request body alone decide it.
  if (rangeSessions.length * parsed.universe.length > MAX_SESSIONS_TIMES_UNIVERSE) {
    return { status: "error", error: "invalid" };
  }
  const period = { from: parsed.from, to: lastSession.date };

  const watchlist = await new WatchlistRepository(db, user).list();
  const watchlistTickers = new Set(watchlist.map((item) => item.ticker));
  if (!parsed.universe.every((ticker) => watchlistTickers.has(ticker))) {
    return { status: "error", error: "invalid" };
  }

  const strategy = await new StrategiesRepository(db, user)
    .findMine(parsed.strategyId)
    .catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) return null;
      throw error;
    });
  const version = strategy?.versions.find((v) => v.id === parsed.strategyVersionId);
  if (!strategy || !version) {
    return { status: "error", error: "not_found" };
  }

  const structure = await resolveStructure(db, version.definition.structureId).catch(
    (error: unknown) => {
      if (error instanceof StructureNotFoundError) return null;
      throw error;
    },
  );
  if (!structure) {
    return { status: "error", error: "not_found" };
  }

  // sessionByDate alone only proves the calendar carries `from`; a `from`
  // in a year with no ingested candles for this universe would still pass
  // it and yield a green, complete, zero-operation run (round 2 item 10).
  // A narrow existence check answers exactly that, one indexed query
  // against the primary key, rather than the whole-period MarketView
  // `run-chunk.ts` needs a 300-second route budget to load: a legal
  // near-ceiling create ran that same load in a Server Action with no
  // raised duration at all, so the platform's own default killed it with
  // no run written after already spending one of ten creation slots
  // (round 3 item 1).
  if (!(await hasCandlesInRange(db, parsed.universe, period))) {
    return { status: "error", error: "invalid" };
  }

  const run = await new BacktestRunRepository(db, user).create({
    strategyId: strategy.id,
    strategyVersionId: version.id,
    structure,
    universe: parsed.universe,
    period,
    initialCapital: parsed.initialCapital,
    costModel: COST_MODEL_PRESETS[parsed.costModel as keyof typeof COST_MODEL_PRESETS],
    riskProfile,
    limits: parsed.limits,
    sizing: version.definition.sizing,
    seed: randomSeed(),
  });

  redirect(`/estrategias/${strategy.id}/backtests/${run.id}`);
}
