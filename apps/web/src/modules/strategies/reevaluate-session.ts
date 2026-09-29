import type { StrategyVersion } from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { calendarUpTo, previousTradingSession, tradingSessionForDate } from "@/modules/market-data";
import { RiskProfileRepository } from "@/modules/portfolio";

import {
  evaluateVersion,
  inboxHorizonFloor,
  isEntryPastInboxHorizon,
  keptOutOfInbox,
  type VersionEvaluation,
} from "./evaluate-version";
import {
  ReevaluationConflictError,
  SignalsRepository,
  type CurrentEvaluation,
  type CurrentSignal,
  type NewEvaluation,
  type NewSignal,
  type ReevaluationCounts,
  type ReevaluationWrite,
} from "./signals-repository";
import { StrategiesRepository, StrategyArchivedError } from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

export type ReevaluationFailureReason =
  | Extract<VersionEvaluation, { ok: false }>["reason"]
  | "unknown_structure"
  | "evaluation_failed"
  | "conflict";

export type ReevaluationOutcome =
  | { status: "applied"; counts: ReevaluationCounts }
  | { status: "unchanged" }
  | { status: "failed"; reason: ReevaluationFailureReason };

export class ReevaluationTargetNotFoundError extends Error {
  constructor() {
    super("No evaluation of this strategy on this session to re-evaluate");
    this.name = "ReevaluationTargetNotFoundError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// The indicator readings count: a decision snapshots them as its
// justification, so a corrected warm-up candle must not leave stale ones.
function sameProposal(current: CurrentSignal, next: NewSignal): boolean {
  return (
    canonicalJson(current.proposal) === canonicalJson(next.proposal) &&
    canonicalJson(current.rule) === canonicalJson(next.rule) &&
    canonicalJson(current.indicators) === canonicalJson(next.indicators)
  );
}

function signalSlot(signal: { kind: string; operationId: string | null }): string {
  return `${signal.kind}|${signal.operationId ?? ""}`;
}

function sameEvaluation(current: CurrentEvaluation, next: NewEvaluation): boolean {
  return (
    current.outcome === next.outcome &&
    current.reason === next.reason &&
    current.detail === next.detail
  );
}

// Re-runs one strategy on one already-evaluated session for the signed-in
// user after its market data was corrected (docs/adr/0047, #84). Only an
// authoritative engine result may change anything, and then only
// append-only: a changed evaluation or proposal supersedes the old row and
// writes a new one; an unchanged proposal keeps its row, read state and
// decision link. A failure records itself in the audit trail and touches
// nothing else.
export async function reevaluateSession(
  db: Database,
  user: ScopedUser,
  input: { strategyId: string; session: string },
  options: { now?: () => number } = {},
): Promise<ReevaluationOutcome> {
  const now = options.now ?? Date.now;
  const strategy = await new StrategiesRepository(db, user).findMine(input.strategyId);
  if (strategy.archivedAt !== null) {
    throw new StrategyArchivedError();
  }
  const signalsRepository = new SignalsRepository(db, user);
  const targets = await signalsRepository.reevaluationTargets(input.strategyId, input.session);
  const tradingSession = await tradingSessionForDate(db, input.session);
  if (targets.evaluations.length === 0 || !tradingSession) {
    throw new ReevaluationTargetNotFoundError();
  }

  const fail = async (reason: ReevaluationFailureReason): Promise<ReevaluationOutcome> => {
    await signalsRepository.recordReevaluation({
      strategyId: input.strategyId,
      session: input.session,
      status: "failed",
      failureReason: reason,
    });
    return { status: "failed", reason };
  };

  const recompute = async (): Promise<
    | { ok: true; evaluations: NewEvaluation[]; signals: NewSignal[]; horizonFloor?: string }
    | { ok: false; reason: ReevaluationFailureReason }
  > => {
    const at = tradingSession.close;
    const since = (await previousTradingSession(db, input.session))?.close;
    const calendar = await calendarUpTo(db, new Date(at));
    const horizonFloor = inboxHorizonFloor(await calendarUpTo(db, new Date(now())));
    const structures = await new StructuresRepository(db).listAll();
    const riskProfile = await new RiskProfileRepository(db, user).current();
    const evaluations: NewEvaluation[] = [];
    const signals: NewSignal[] = [];

    const versionIds = [...new Set(targets.evaluations.map((row) => row.strategyVersionId))];
    for (const versionId of versionIds) {
      const version = strategy.versions.find((candidate) => candidate.id === versionId);
      const structure = structures.find(
        (candidate) => candidate.id === version?.definition.structureId,
      );
      if (!version || !structure) {
        return { ok: false, reason: "unknown_structure" };
      }
      const strategyVersion: StrategyVersion = {
        id: version.id,
        definition: version.definition,
        structure,
      };
      const tickers = targets.evaluations
        .filter((row) => row.strategyVersionId === versionId)
        .map((row) => row.ticker);
      // The horizon is applied below, only to proposals that would be
      // written anew: re-evaluating an old session must not retract an
      // inbox signal merely because it has aged.
      const evaluation = await evaluateVersion(db, {
        strategyId: input.strategyId,
        strategyVersion,
        tickers,
        calendar,
        at,
        since,
        riskProfile,
        horizonFloor: undefined,
      });
      if (!evaluation.ok) {
        return { ok: false, reason: evaluation.reason };
      }
      evaluations.push(...evaluation.evaluations.filter((row) => row.session === input.session));
      signals.push(...evaluation.signals.filter((row) => row.session === input.session));
    }
    return { ok: true, evaluations, signals, horizonFloor };
  };

  // The failure is recorded outside the recomputation's own error handling,
  // so an audit insert that fails surfaces instead of being retried as an
  // evaluation failure.
  let recomputed: Awaited<ReturnType<typeof recompute>>;
  try {
    recomputed = await recompute();
  } catch {
    recomputed = { ok: false, reason: "evaluation_failed" };
  }
  if (!recomputed.ok) {
    return fail(recomputed.reason);
  }
  const { horizonFloor } = recomputed;

  const write: ReevaluationWrite = {
    strategyId: input.strategyId,
    session: input.session,
    supersededEvaluationIds: [],
    newEvaluations: [],
    retractedSignalIds: [],
    replacedSignalIds: [],
    newSignals: [],
  };
  for (const current of targets.evaluations) {
    const sameKey = (row: { strategyVersionId: string; ticker: string }) =>
      row.strategyVersionId === current.strategyVersionId && row.ticker === current.ticker;
    const next = recomputed.evaluations.find(sameKey);
    // No record for this ticker means the engine said nothing about it, which
    // is no authority to change what is stored.
    if (!next) continue;

    const currentSignals = targets.signals.filter(sameKey);
    const nextSignals = recomputed.signals.filter(sameKey);
    let pastHorizon = false;
    for (const signal of nextSignals) {
      const predecessor = currentSignals.find((row) => signalSlot(row) === signalSlot(signal));
      if (predecessor && sameProposal(predecessor, signal)) continue;
      if (isEntryPastInboxHorizon(signal, horizonFloor)) {
        pastHorizon = true;
        if (predecessor) write.retractedSignalIds.push(predecessor.id);
        continue;
      }
      if (predecessor) write.replacedSignalIds.push(predecessor.id);
      write.newSignals.push(signal);
    }
    for (const signal of currentSignals) {
      if (!nextSignals.some((row) => signalSlot(row) === signalSlot(signal))) {
        write.retractedSignalIds.push(signal.id);
      }
    }

    const finalEvaluation = pastHorizon ? keptOutOfInbox(next) : next;
    if (!sameEvaluation(current, finalEvaluation)) {
      write.supersededEvaluationIds.push(current.id);
      write.newEvaluations.push(finalEvaluation);
    }
  }

  const changed =
    write.supersededEvaluationIds.length +
    write.retractedSignalIds.length +
    write.replacedSignalIds.length +
    write.newSignals.length;
  if (changed === 0) {
    await signalsRepository.recordReevaluation({
      strategyId: input.strategyId,
      session: input.session,
      status: "unchanged",
      failureReason: null,
    });
    return { status: "unchanged" };
  }
  try {
    const counts = await signalsRepository.applyReevaluation(write);
    return { status: "applied", counts };
  } catch (error) {
    // The losing write rolled back with its own audit row; record the attempt
    // outside it so every attempt stays in the trail.
    if (error instanceof ReevaluationConflictError) {
      await fail("conflict");
    }
    throw error;
  }
}
