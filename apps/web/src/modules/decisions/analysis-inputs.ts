import { analysisInputsSchema, type AnalysisFacts, type AnalysisInputs } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { BacktestRunNotFoundError, getMyBacktestRun } from "@/modules/backtests";
import { latestSessionOnOrBefore } from "@/modules/market-data";
import {
  ContemplatedOperationNotFoundError,
  getMyHeldOperation,
  getMyOperation,
  HeldOperationNotFoundError,
  priceOperationNow,
} from "@/modules/portfolio";
import { getMySignal, getStructures, SignalNotFoundError } from "@/modules/strategies";

import {
  backtestRunFacts,
  contemplatedOperationFacts,
  heldOperationFacts,
  signalFacts,
} from "./analysis-facts";

export type AssembleAnalysisInputsResult =
  { ok: true; inputs: AnalysisInputs } | { ok: false; reason: "not_found" | "not_ready" };

async function currentSession(): Promise<string | null> {
  const session = await latestSessionOnOrBefore(getDb(), new Date());
  return session?.date ?? null;
}

// A subject whose assembled facts fail `analysisInputsSchema` (an
// unexpectedly deep tree, a key the schema rejects) is not analyzable yet,
// the same as a missing session or pricing: never an unhandled error the
// route handler would surface as a 500 (docs/adr/0057).
export function toAssembleResult(
  subject: AnalysisInputs["subject"],
  facts: AnalysisFacts,
): AssembleAnalysisInputsResult {
  const parsed = analysisInputsSchema.safeParse({ subject, facts });
  return parsed.success ? { ok: true, inputs: parsed.data } : { ok: false, reason: "not_ready" };
}

async function assembleSignalInputs(subjectId: string): Promise<AssembleAnalysisInputsResult> {
  const signal = await getMySignal(subjectId);
  const facts = signalFacts({
    session: signal.session,
    kind: signal.kind,
    ticker: signal.ticker,
    timeframe: signal.timeframe,
    indicators: signal.indicators,
    rule: signal.rule,
    proposal: signal.proposal,
  });
  return toAssembleResult("signal", facts);
}

async function assembleContemplatedOperationInputs(
  subjectId: string,
): Promise<AssembleAnalysisInputsResult> {
  const operation = await getMyOperation(subjectId);
  const [structures, session, pricing] = await Promise.all([
    getStructures(),
    currentSession(),
    priceOperationNow(operation.underlying, operation.legs),
  ]);
  if (!session || !pricing) {
    return { ok: false, reason: "not_ready" };
  }
  const structure = structures.find((candidate) => candidate.id === operation.structureId);
  const facts = contemplatedOperationFacts({
    session,
    structure: structure?.name ?? operation.structureId,
    underlying: operation.underlying,
    pricing,
  });
  return toAssembleResult("contemplated_operation", facts);
}

async function assembleHeldOperationInputs(
  subjectId: string,
): Promise<AssembleAnalysisInputsResult> {
  const held = await getMyHeldOperation(subjectId);
  const [session, pricing] = await Promise.all([
    currentSession(),
    priceOperationNow(
      held.underlying,
      held.legs.map((leg) => ({
        role: leg.role,
        side: leg.side,
        ticker: leg.ticker,
        quantity: leg.quantity,
      })),
      { excludeOperationId: held.id },
    ),
  ]);
  if (!session || !pricing) {
    return { ok: false, reason: "not_ready" };
  }
  const facts = heldOperationFacts({
    session,
    underlying: held.underlying,
    openedAt: held.openedAt,
    expiry: held.expiry,
    legs: held.legs,
    pricing,
  });
  return toAssembleResult("held_operation", facts);
}

async function assembleBacktestRunInputs(subjectId: string): Promise<AssembleAnalysisInputsResult> {
  const run = await getMyBacktestRun(subjectId);
  if (run.status !== "complete" || !run.result) {
    return { ok: false, reason: "not_ready" };
  }
  const { result } = run;
  const facts = backtestRunFacts({
    period: run.period,
    timeframe: result.config.strategy.definition.timeframe,
    universe: run.universe,
    initialCapital: run.initialCapital,
    costModel: run.costModel,
    strategy: result.config.strategy.definition,
    metrics: result.metrics,
    walkForward: result.walkForward ?? [],
    counts: {
      operations: result.operations.length,
      missedEntries: result.missedEntries.length,
      limitBreaches: result.limitBreaches.length,
    },
    notes: result.notes.map((note) => note.code),
  });
  return toAssembleResult("backtest_run", facts);
}

// Ownership of every subject is enforced here, through each owning
// module's own user-scoped entry point (`getMySignal`, `getMyOperation`,
// `getMyHeldOperation`, `getMyBacktestRun`): this module never reads a
// subject table directly (docs/adr/0057).
export async function assembleAnalysisInputs(
  subjectKind: AnalysisInputs["subject"],
  subjectId: string,
): Promise<AssembleAnalysisInputsResult> {
  try {
    switch (subjectKind) {
      case "signal":
        return await assembleSignalInputs(subjectId);
      case "contemplated_operation":
        return await assembleContemplatedOperationInputs(subjectId);
      case "held_operation":
        return await assembleHeldOperationInputs(subjectId);
      case "backtest_run":
        return await assembleBacktestRunInputs(subjectId);
    }
  } catch (error) {
    if (
      error instanceof SignalNotFoundError ||
      error instanceof ContemplatedOperationNotFoundError ||
      error instanceof HeldOperationNotFoundError ||
      error instanceof BacktestRunNotFoundError
    ) {
      return { ok: false, reason: "not_found" };
    }
    throw error;
  }
}
