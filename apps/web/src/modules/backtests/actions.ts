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
  candleSessionBoundsInRange,
  canSatisfyCollection,
} from "@/modules/market-data";
import { getCurrentRiskProfile } from "@/modules/portfolio";
import { StrategiesRepository, StrategyNotFoundError } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import { BacktestRunRepository } from "./backtest-run-repository";
import { COST_MODEL_PRESETS, costModelPresetIds, walkForwardWindowOptions } from "./default-config";
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
  walkForwardWindowSessions: z.union(walkForwardWindowOptions.map((value) => z.literal(value))),
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

  // Neither raw endpoint is trusted as a real trading session (weekend,
  // holiday, or outside the calendar's own reach) or as a session with any
  // ingested candle: both are clamped, below, to what the universe's own
  // candle history actually covers. An end date in the future is a common
  // and harmless request ("run until today"), so `to` is clamped rather
  // than rejected.
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

  // Bounding a `from` the calendar carries but that has no ingested candle
  // for this universe closed round-2 item 10 for `to` only (round 5 item
  // 1); `from` had the identical exposure and was the larger one (round 6
  // item 1): `FIRST_INGESTED_CALENDAR_YEAR` seeds the ANBIMA calendar far
  // earlier than COTAHIST candle history actually starts (candle ingestion
  // began whenever this app first ran it, then back-fills only
  // `RECENT_SESSION_WINDOW` sessions on top of that), so a `from` before
  // that start bought hundreds of candle-less period sessions with no
  // note, diluting CAGR, Sharpe and exposure on an immutable run. One
  // `MIN()`/`MAX()` aggregate query against the `(ticker, timeframe,
  // session)` index gives existence and both clamps together — not the
  // whole-period MarketView `run-chunk.ts` needs a 300-second route budget
  // to load: a legal near-ceiling create ran that same load in a Server
  // Action with no raised duration at all, so the platform's own default
  // killed it with no run written after already spending one of ten
  // creation slots (round 3 item 1).
  const candleBounds = await candleSessionBoundsInRange(db, parsed.universe, {
    from: parsed.from,
    to: lastCalendarSession.date,
  });
  if (!candleBounds) {
    return { status: "error", error: "invalid" };
  }
  const period = { from: candleBounds.first, to: candleBounds.last };

  // Mirrors the nightly evaluator's own refusal (`evaluate-signals.ts`):
  // an `iv_rank` strategy's every session reads `insufficient_data`, no
  // signal ever fires, and the run completes green, immutable and empty —
  // the same shape round-1 item 2 and round-2 item 1 were blocked for.
  // Refused here, before the immutable row exists, rather than left to
  // complete silently. `canSatisfyCollection` is market-data's own fact
  // about what its loader can fill, asked here and by evaluate-signals.ts
  // rather than each hardcoding `"impliedVolatilityIndex"` independently
  // (round 6 item 9): when #81 lands, one place changes, not two.
  const strategyVersion: StrategyVersion = {
    id: version.id,
    definition: version.definition,
    structure,
  };
  const fromSession = calendar.find((session) => session.date === period.from);
  const toSession = calendar.find((session) => session.date === period.to);
  if (!fromSession || !toSession) {
    return { status: "error", error: "invalid" };
  }
  const window = engine.dataWindow({
    strategy: strategyVersion,
    instruments: parsed.universe,
    calendar,
    at: toSession.close,
    since: fromSession.open,
  });
  if (window.collections.some((collection) => !canSatisfyCollection(collection))) {
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
    walkForward: { windowSessions: parsed.walkForwardWindowSessions },
    seed: randomSeed(),
  });

  redirect(`/estrategias/${strategy.id}/backtests/${run.id}`);
}
