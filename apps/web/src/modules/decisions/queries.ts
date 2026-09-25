import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import {
  DecisionScoresRepository,
  type DecisionScoreRow,
  type TrackRecordStats,
} from "./decision-scores-repository";
import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";

export const getMyDecisions = cache(async (): Promise<DecisionListItem[]> => {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.listMine();
});

// The journal's score column, batched over this user's own decisions in one
// query (brief item 4): a decision with no score row yet is simply absent
// from the map, and `JournalEntry` renders "pendente" for it.
export const getMyDecisionScores = cache(
  async (decisionIds: readonly string[]): Promise<Map<string, DecisionScoreRow>> => {
    if (decisionIds.length === 0) return new Map();
    const repository = await forCurrentUser(getDb(), DecisionScoresRepository);
    return repository.findForDecisions(decisionIds);
  },
);

export const getMyTrackRecordStats = cache(async (): Promise<TrackRecordStats> => {
  const repository = await forCurrentUser(getDb(), DecisionScoresRepository);
  return repository.trackRecordStats();
});

// SignalRow's own "answered" state (brief item 5), batched over the given
// page of signal ids in one query instead of one per row (and independent
// of `listMine`'s `JOURNAL_LIMIT`, round 3): a signal with no decision yet
// is simply absent from the map.
export async function getMyDecisionsBySignalId(
  signalIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.findForSignals(signalIds);
}

// The `/carteira` row's own "answered" state, batched the same way over the
// given page of contemplated operation ids.
export async function getMyDecisionsByOperationId(
  operationIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  return repository.findLatestForOperations(operationIds);
}
