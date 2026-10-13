import { cache } from "react";
import type { AnalysisSubjectKind } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser } from "@/modules/auth";

import {
  AnalysesRepository,
  type AnalysisUsage,
  type JournalAnalysis,
  type LatestAcceptedAnalysis,
} from "./analyses-repository";
import {
  AnalysisScoresRepository,
  type AnalysisScoreRow,
  type AnalysisTrackRecordStats,
} from "./analysis-scores-repository";
import { readAnthropicApiKey } from "./analysis-model";
import {
  DecisionScoresRepository,
  type DecisionScoreRow,
  type TrackRecordStats,
} from "./decision-scores-repository";
import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";

export const getMyDecisions = cache(async (): Promise<DecisionListItem[]> => {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  await recordAccess("decisions_read");
  return repository.listMine();
});

// The journal's score column, batched over this user's own decisions in one
// query (brief item 4): a decision with no score row yet is simply absent
// from the map, and `JournalEntry` renders "pendente" for it.
export const getMyDecisionScores = cache(
  async (decisionIds: readonly string[]): Promise<Map<string, DecisionScoreRow>> => {
    if (decisionIds.length === 0) return new Map();
    const repository = await forCurrentUser(getDb(), DecisionScoresRepository);
    await recordAccess("decisions_read");
    return repository.findForDecisions(decisionIds);
  },
);

export const getMyTrackRecordStats = cache(async (): Promise<TrackRecordStats> => {
  const repository = await forCurrentUser(getDb(), DecisionScoresRepository);
  await recordAccess("decisions_read");
  return repository.trackRecordStats();
});

// SignalRow's own "answered" state (brief item 5), batched over the given
// page of signal ids in one query instead of one per row (and independent
// of `listMine`'s `JOURNAL_LIMIT`): a signal with no decision yet
// is simply absent from the map.
export async function getMyDecisionsBySignalId(
  signalIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  await recordAccess("decisions_read");
  return repository.findForSignals(signalIds);
}

// The `/carteira` row's own "answered" state, batched the same way over the
// given page of contemplated operation ids.
export async function getMyDecisionsByOperationId(
  operationIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  await recordAccess("decisions_read");
  return repository.findLatestForOperations(operationIds);
}

// A suggestion card's own "answered" state (docs/adr/0067), batched over the cards on screen.
export async function getMyDecisionsBySuggestionId(
  suggestionIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  await recordAccess("decisions_read");
  return repository.findForSuggestions(suggestionIds);
}

// The portfolio's open operations' own latest decision, batched the same way.
export async function getMyDecisionsByHeldOperationId(
  operationIds: readonly string[],
): Promise<Map<string, DecisionListItem>> {
  const repository = await forCurrentUser(getDb(), DecisionsRepository);
  await recordAccess("decisions_read");
  return repository.findLatestForHeldOperations(operationIds);
}

// The latest accepted AI analysis per subject of one kind, batched over a
// page of ids (docs/adr/0057): a subject with none yet is simply absent
// from the map.
export async function getMyLatestAnalyses(
  subjectKind: AnalysisSubjectKind,
  subjectIds: readonly string[],
): Promise<Map<string, LatestAcceptedAnalysis>> {
  const repository = await forCurrentUser(getDb(), AnalysesRepository);
  await recordAccess("decisions_read");
  return repository.latestAccepted(subjectKind, subjectIds);
}

// The journal's analyses (docs/adr/0058): every accepted one, newest first.
export const getMyJournalAnalyses = cache(async (): Promise<JournalAnalysis[]> => {
  const repository = await forCurrentUser(getDb(), AnalysesRepository);
  await recordAccess("decisions_read");
  return repository.listAcceptedForJournal();
});

export const getMyAnalysisScores = cache(
  async (requestIds: readonly string[]): Promise<Map<string, AnalysisScoreRow>> => {
    if (requestIds.length === 0) return new Map();
    const repository = await forCurrentUser(getDb(), AnalysisScoresRepository);
    await recordAccess("decisions_read");
    return repository.findForRequests(requestIds);
  },
);

export const getMyAnalysisTrackRecordStats = cache(async (): Promise<AnalysisTrackRecordStats> => {
  const repository = await forCurrentUser(getDb(), AnalysisScoresRepository);
  await recordAccess("decisions_read");
  return repository.trackRecordStats();
});

export const getMyAnalysisUsage = cache(async (): Promise<AnalysisUsage> => {
  const repository = await forCurrentUser(getDb(), AnalysesRepository);
  await recordAccess("decisions_read");
  return repository.usageThisMonth();
});

// Whether `ANTHROPIC_API_KEY` is configured at all (docs/adr/0057): the
// screen shows the analysis feature as unavailable rather than offering an
// action that would always answer `unavailable`.
export function isAnalysisAvailable(): boolean {
  return readAnthropicApiKey() !== undefined;
}
