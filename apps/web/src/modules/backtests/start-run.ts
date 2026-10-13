import { z } from "zod";
import { centavosSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";
import { getDb } from "@/db/client";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
} from "@/modules/auth";
import { calendarUpTo, candleSessionBoundsInRange, isMarketIndex } from "@/modules/market-data";
import { getCurrentRiskProfile } from "@/modules/portfolio";
import { StrategiesRepository, StrategyNotFoundError } from "@/modules/strategies";
import { WatchlistRepository } from "@/modules/watchlist";

import {
  ActiveBacktestRunLimitError,
  BacktestRunRepository,
  type BacktestRunRecord,
} from "./backtest-run-repository";
import { COST_MODEL_PRESETS, costModelPresetIds, walkForwardWindowOptions } from "./default-config";
import { resolveStructure, StructureNotFoundError } from "./run-chunk";

export type StartBacktestRunError =
  | "invalid"
  | "not_found"
  | "rate_limited"
  | "no_risk_profile"
  | "too_many_active"
  | "archived"
  | "index_in_universe";

export type StartBacktestRunResult =
  | { status: "ok"; strategyId: string; runId: string }
  | { status: "error"; error: StartBacktestRunError };

export const startBacktestRunInputSchema = z.strictObject({
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
// never fires. Every chunk re-materialises the *whole*
// MarketView on every call regardless of how many sessions it then
// simulates (run-chunk.ts), so the real constraint is what one such call
// can load and index before its own wall-clock budget: measured at
// ~23.5s for 250 sessions x 50 tickers (12,500 candles) against
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

export type StartBacktestRunInput = z.infer<typeof startBacktestRunInputSchema>;

// Creates a pending run for the signed-in user; the caller runs it inside
// `withAuthenticatedAction` and decides where to send the user next.
export async function startBacktestRun(
  parsed: StartBacktestRunInput,
): Promise<StartBacktestRunResult> {
  if (parsed.from >= parsed.to) {
    return { status: "error", error: "invalid" };
  }
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
  // A market index cannot reach a backtest (design-307.md section 1 rule 2): ATR, high/low
  // and tradedQuantity conditions must never read its synthetic candle.
  if (parsed.universe.some((ticker) => isMarketIndex(ticker))) {
    return { status: "error", error: "index_in_universe" };
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
  // Archived strategies are read-only (docs/adr/0043): the version itself
  // stays readable so existing runs, signals and decisions remain, but no
  // new run may start against it.
  if (strategy.archivedAt) {
    return { status: "error", error: "archived" };
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
  // for this universe: an earlier fix closed this for `to` only; `from` had the identical
  // exposure and was the larger one: `FIRST_INGESTED_CALENDAR_YEAR` seeds
  // the ANBIMA calendar far
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
  // creation slots. The bound is still the union across `parsed.universe`,
  // not a per-ticker intersection (candle-repository.ts): a multi-ticker
  // universe can now carry an interior candle-less gap between this union's
  // own bounds, which #92/ADR-0041 has the engine exclude from
  // `metrics.sessions` (and note) rather than this clamp trying to bound it
  // away.
  const candleBounds = await candleSessionBoundsInRange(db, parsed.universe, {
    from: parsed.from,
    to: lastCalendarSession.date,
  });
  if (!candleBounds) {
    return { status: "error", error: "invalid" };
  }
  const period = { from: candleBounds.first, to: candleBounds.last };

  let run: BacktestRunRecord;
  try {
    run = await new BacktestRunRepository(db, user).create({
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
  } catch (error) {
    if (error instanceof ActiveBacktestRunLimitError) {
      return { status: "error", error: "too_many_active" };
    }
    throw error;
  }

  return { status: "ok", strategyId: strategy.id, runId: run.id };
}
