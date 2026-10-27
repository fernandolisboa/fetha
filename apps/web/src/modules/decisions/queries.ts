import { cache } from "react";
import { sessionDateSchema, type AnalysisObjectKind } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser } from "@/modules/auth";
import { newestReadSession, recipeStructureById } from "@/modules/radar";

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
import {
  DecisionScoresRepository,
  type DecisionScoreRow,
  type TrackRecordStats,
} from "./decision-scores-repository";
import { DecisionsRepository, type DecisionListItem } from "./decisions-repository";
import { researchCalibration, type ResearchCalibration } from "./research-calibration";
import { ResearchRepository } from "./research-repository";
import { ResearchScoresRepository } from "./research-scores-repository";
import { researchViewOf, type ResearchView } from "./research-view";

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
  subjectKind: AnalysisObjectKind,
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

// The user's latest stored research, only while the radar has not read a newer close than the
// one it was made at (docs/adr/0076): an older one is not shown on the home page.
export async function getMyCurrentResearch(): Promise<ResearchView | null> {
  const db = getDb();
  const newest = await newestReadSession(db);
  if (newest === null) return null;
  const repository = await forCurrentUser(db, ResearchRepository);
  await recordAccess("decisions_read");
  const research = await repository.latest();
  if (!research || research.newestClose !== newest) return null;
  const decisions = await (
    await forCurrentUser(db, DecisionsRepository)
  ).findForResearchIdeas(research.ideas.map((idea) => idea.id));
  return researchViewOf({
    research,
    decisions,
    newestReadSession: sessionDateSchema.parse(newest),
  });
}

// The journal's "Pesquisas do Fetha" panel (docs/adr/0076): this user's own scored ideas, by
// verdict.
export async function getMyResearchCalibration(): Promise<ResearchCalibration> {
  const repository = await forCurrentUser(getDb(), ResearchScoresRepository);
  await recordAccess("decisions_read");
  return researchCalibration(await repository.allMine());
}

// The structure, underlying and legs of one of this user's stored research ideas, for the
// builder's "Montar no simulador" link (docs/adr/0076); null for an id that is not theirs.
export async function getMyResearchIdeaLot(ideaId: string) {
  const repository = await forCurrentUser(getDb(), ResearchRepository);
  await recordAccess("decisions_read");
  const idea = await repository.findIdea(ideaId);
  const structure = idea ? recipeStructureById(idea.recipeId) : null;
  if (!idea || !structure) return null;
  return {
    underlying: idea.underlying,
    structureId: structure.id,
    legs: idea.legs.map(({ role, side, ticker, quantity }) => ({ role, side, ticker, quantity })),
  };
}
