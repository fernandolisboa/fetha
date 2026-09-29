import type { Instant, RiskProfile, Ticker } from "@fetha/contracts";
import { engine, type Signal, type StrategyVersion, type TradingSession } from "@fetha/engine";

import type { Database } from "@/db/client";
import {
  loadMarketView,
  MarketViewTooLargeError,
  MarketViewUnavailableError,
} from "@/modules/market-data";

import type { NewEvaluation, NewSignal } from "./signals-repository";

// One trading week (docs/adr/0044, #83): an entry proposal from an older
// session was priced at a spot that is now stale and sized against today's
// risk profile, so the catch-up still logs its evaluation but keeps it out
// of the inbox.
export const INBOX_ENTRY_SESSION_HORIZON = 5;

function signalToNewSignal(strategyId: string, signal: Signal): NewSignal {
  const base = {
    strategyId,
    strategyVersionId: signal.strategyVersionId,
    ticker: signal.ticker,
    timeframe: signal.timeframe,
    session: signal.session,
    at: new Date(signal.at),
    indicators: signal.indicators,
  };
  if (signal.kind === "entry") {
    return { ...base, kind: "entry", proposal: signal.proposal, operationId: null, rule: null };
  }
  if (signal.kind === "exit") {
    return {
      ...base,
      kind: "exit",
      proposal: null,
      operationId: signal.operationId,
      rule: signal.rule,
    };
  }
  return {
    ...base,
    kind: "adjust",
    proposal: signal.proposal,
    operationId: signal.operationId,
    rule: signal.rule,
  };
}

// The oldest session whose entry proposals may still reach the inbox: the
// `INBOX_ENTRY_SESSION_HORIZON`-th newest session closed by the wall clock,
// not by `at`, so a provider publishing a week late cannot push a week of
// stale proposals past the horizon. Undefined when the calendar is shorter
// than the horizon, so nothing is past it.
export function inboxHorizonFloor(closedSessions: readonly TradingSession[]): string | undefined {
  return closedSessions.at(-INBOX_ENTRY_SESSION_HORIZON)?.date;
}

export function isEntryPastInboxHorizon(
  signal: { kind: Signal["kind"]; session: string },
  floor: string | undefined,
): boolean {
  return signal.kind === "entry" && floor !== undefined && signal.session < floor;
}

// The record of an entry the engine proposed but the horizon kept out of the
// inbox: outcome stays `signal`, reason says why no row reached the inbox.
export function keptOutOfInbox(evaluation: NewEvaluation): NewEvaluation {
  if (evaluation.reason !== "signal") return evaluation;
  return {
    ...evaluation,
    reason: "entry_past_inbox_horizon",
    detail: String(INBOX_ENTRY_SESSION_HORIZON),
  };
}

export interface VersionEvaluationInput {
  strategyId: string;
  strategyVersion: StrategyVersion;
  tickers: Ticker[];
  calendar: TradingSession[];
  at: Instant;
  since: Instant | undefined;
  riskProfile: RiskProfile | null;
  horizonFloor: string | undefined;
}

// A result the engine actually produced, or the web-authored reason it never
// got to: the nightly run records a failure row for the latter, a
// re-evaluation (docs/adr/0047) refuses to retract anything on it.
export type VersionEvaluation =
  | { ok: true; signals: NewSignal[]; evaluations: NewEvaluation[] }
  | {
      ok: false;
      reason: "market_view_too_large" | "no_market_data" | "engine_error";
      detail: string | null;
    };

// One strategy version over `tickers` for the sessions in `(since, at]`:
// the market view, the engine call and the inbox horizon, shared by the
// nightly evaluation and a session re-evaluation so the two can never
// disagree about what the same data means.
export async function evaluateVersion(
  db: Database,
  input: VersionEvaluationInput,
): Promise<VersionEvaluation> {
  const { strategyId, strategyVersion, tickers, calendar, at, since, riskProfile } = input;
  const window = engine.dataWindow({
    strategy: strategyVersion,
    instruments: tickers,
    calendar,
    at,
    since,
  });

  // `loadMarketView` throws instead of returning a candle-less view for a
  // window it cannot resolve or a chain too large to load in one call (#18,
  // market-view.ts). Uncaught, one option strategy that crosses the chain
  // cap would cost the user every remaining strategy's evaluation for the
  // night, deterministically, every run.
  let view;
  try {
    view = await loadMarketView(db, window);
  } catch (error) {
    if (error instanceof MarketViewTooLargeError) {
      return { ok: false, reason: "market_view_too_large", detail: null };
    }
    if (error instanceof MarketViewUnavailableError) {
      return { ok: false, reason: "no_market_data", detail: null };
    }
    throw error;
  }

  const result = await engine.evaluateStrategy({
    view,
    strategy: strategyVersion,
    instruments: tickers,
    at,
    since,
    ...(riskProfile ? { riskProfile } : {}),
  });
  if (!result.ok) {
    return { ok: false, reason: "engine_error", detail: result.error.code };
  }

  const pastHorizon = new Set<string>();
  const signals: NewSignal[] = [];
  for (const signal of result.value.signals) {
    if (isEntryPastInboxHorizon(signal, input.horizonFloor)) {
      pastHorizon.add(`${signal.ticker}|${signal.session}`);
    } else {
      signals.push(signalToNewSignal(strategyId, signal));
    }
  }
  // `detail` is always null for a row built straight from the engine's own
  // `EvaluationRecord` (ADR-0039); only web-authored reasons carry one.
  const evaluations: NewEvaluation[] = result.value.evaluations.map((record) => {
    const evaluation: NewEvaluation = {
      strategyId,
      strategyVersionId: strategyVersion.id,
      ticker: record.ticker,
      session: record.session,
      at: new Date(record.at),
      outcome: record.outcome,
      reason: record.reason,
      detail: null,
    };
    return pastHorizon.has(`${record.ticker}|${record.session}`)
      ? keptOutOfInbox(evaluation)
      : evaluation;
  });
  return { ok: true, signals, evaluations };
}
