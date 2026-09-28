import type { StrategyVersion } from "@fetha/engine";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { calendarUpTo, previousTradingSession, tradingSessionForDate } from "@/modules/market-data";
import { RiskProfileRepository } from "@/modules/portfolio";

import {
  evaluateVersion,
  INBOX_ENTRY_SESSION_HORIZON,
  inboxHorizonFloor,
} from "./evaluate-version";
import {
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

export type ReevaluationOutcome =
  | { status: "applied"; counts: ReevaluationCounts }
  | { status: "unchanged" }
  | { status: "failed"; reason: string };

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

function sameProposal(current: CurrentSignal, next: NewSignal): boolean {
  return (
    canonicalJson(current.proposal) === canonicalJson(next.proposal) &&
    canonicalJson(current.rule) === canonicalJson(next.rule)
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
// user after its market data was corrected (docs/adr/0045, #84). Only an
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

  const fail = async (reason: string): Promise<ReevaluationOutcome> => {
    await signalsRepository.recordReevaluation({
      strategyId: input.strategyId,
      session: input.session,
      status: "failed",
      failureReason: reason,
    });
    return { status: "failed", reason };
  };

  const recomputed: { evaluations: NewEvaluation[]; signals: NewSignal[] } = {
    evaluations: [],
    signals: [],
  };
  let horizonFloor: string | undefined;
  try {
    const at = tradingSession.close;
    const since = (await previousTradingSession(db, input.session))?.close;
    const calendar = await calendarUpTo(db, new Date(at));
    horizonFloor = inboxHorizonFloor(await calendarUpTo(db, new Date(now())));
    const structures = await new StructuresRepository(db).listAll();
    const riskProfile = await new RiskProfileRepository(db, user).current();

    const versionIds = [...new Set(targets.evaluations.map((row) => row.strategyVersionId))];
    for (const versionId of versionIds) {
      const version = strategy.versions.find((candidate) => candidate.id === versionId);
      const structure = structures.find(
        (candidate) => candidate.id === version?.definition.structureId,
      );
      if (!version || !structure) {
        return await fail("unknown_structure");
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
        return await fail(evaluation.reason);
      }
      recomputed.evaluations.push(
        ...evaluation.evaluations.filter((row) => row.session === input.session),
      );
      recomputed.signals.push(...evaluation.signals.filter((row) => row.session === input.session));
    }
  } catch {
    return await fail("evaluation_failed");
  }

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
    let keptOutOfInbox = false;
    for (const signal of nextSignals) {
      const predecessor = currentSignals.find((row) => signalSlot(row) === signalSlot(signal));
      if (predecessor && sameProposal(predecessor, signal)) continue;
      if (signal.kind === "entry" && horizonFloor !== undefined && signal.session < horizonFloor) {
        keptOutOfInbox = true;
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

    const finalEvaluation: NewEvaluation =
      keptOutOfInbox && next.reason === "signal"
        ? {
            ...next,
            reason: "entry_past_inbox_horizon",
            detail: String(INBOX_ENTRY_SESSION_HORIZON),
          }
        : next;
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
  const counts = await signalsRepository.applyReevaluation(write);
  return { status: "applied", counts };
}
