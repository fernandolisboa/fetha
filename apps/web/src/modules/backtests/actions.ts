"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { centavosSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { engine, type StrategyVersion } from "@fetha/engine";

import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  calendarUpTo,
  lastCandleSessionInRange,
  tradingSessionForDate,
} from "@/modules/market-data";
import { getCurrentRiskProfile } from "@/modules/portfolio";
import { StrategiesRepository, StrategyNotFoundError } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { COST_MODEL_PRESETS, costModelPresetIds } from "./default-config";
import { resolveStructure, StructureNotFoundError } from "./run-chunk";

export type CreateBacktestRunResult = {
  status: "error";
  error: "invalid" | "not_found" | "rate_limited" | "no_risk_profile" | "unsatisfiable_collection";
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
  const fromSession = await tradingSessionForDate(db, parsed.from);
  if (!fromSession) {
    return { status: "error", error: "invalid" };
  }
  const calendar = await calendarUpTo(db, new Date(`${parsed.to}T23:59:59.999Z`));
  const rangeSessions = calendar.filter((session) => session.date >= parsed.from);
  const lastCalendarSession = rangeSessions.at(-1);
  if (!lastCalendarSession) {
    return { status: "error", error: "invalid" };
  }
  // Every chunk re-materialises the whole-period MarketView: bounding
  // sessions x universe at creation keeps a single run's data footprint
  // sane rather than letting the request body alone decide it.
  if (rangeSessions.length * parsed.universe.length > MAX_SESSIONS_TIMES_UNIVERSE) {
    return { status: "error", error: "invalid" };
  }

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

  // tradingSessionForDate alone only proves the calendar carries `from`; a `from`
  // in a year with no ingested candles for this universe would still pass
  // it and yield a green, complete, zero-operation run (round 2 item 10).
  // The same query also gives the data-clamped `to` (round 5 item 1): the
  // ANBIMA calendar is ingested ~15 months past the newest candle
  // (`runCalendarSources`, `market-data/ingest.ts`), so clamping `to` to
  // the calendar alone (as this used to) lets every session in that gap
  // count as a traded period session with no trade in it, diluting
  // `computeBacktestMetrics`'s `sessions = equityCurve.length` divisor for
  // CAGR, Sharpe and exposure with no note on an immutable run. One indexed
  // query against the `(ticker, timeframe, session)` index, not the
  // whole-period MarketView `run-chunk.ts` needs a 300-second route budget
  // to load: a legal near-ceiling create ran that same load in a Server
  // Action with no raised duration at all, so the platform's own default
  // killed it with no run written after already spending one of ten
  // creation slots (round 3 item 1).
  const lastCandleSession = await lastCandleSessionInRange(db, parsed.universe, {
    from: parsed.from,
    to: lastCalendarSession.date,
  });
  if (!lastCandleSession) {
    return { status: "error", error: "invalid" };
  }
  const period = { from: parsed.from, to: lastCandleSession };

  // Mirrors the nightly evaluator's own refusal (`evaluate-signals.ts`,
  // `UNSATISFIABLE_COLLECTION_CODE`): no ingestion source fills
  // `impliedVolatilityIndex` yet (#81), so an `iv_rank` strategy's every
  // session reads `insufficient_data`, no signal ever fires, and the run
  // completes green, immutable and empty — the same shape round-1 item 2
  // and round-2 item 1 were blocked for. Refused here, before the
  // immutable row exists, rather than left to complete silently.
  const strategyVersion: StrategyVersion = {
    id: version.id,
    definition: version.definition,
    structure,
  };
  const toSession = calendar.find((session) => session.date === period.to);
  if (!toSession) {
    return { status: "error", error: "invalid" };
  }
  const window = engine.dataWindow({
    strategy: strategyVersion,
    instruments: parsed.universe,
    calendar,
    at: toSession.close,
    since: fromSession.open,
  });
  if (window.collections.includes("impliedVolatilityIndex")) {
    return { status: "error", error: "unsatisfiable_collection" };
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
