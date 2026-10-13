import { cache } from "react";
import type { Structure } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import type { EvaluationLogItem, SignalListItem } from "./signals-repository";
import { SignalsRepository } from "./signals-repository";
import {
  StrategiesRepository,
  type StrategySummary,
  type StrategyWithVersions,
} from "./strategies-repository";
import { StructuresRepository } from "./structures-repository";

export const getMyStrategies = cache(async (): Promise<StrategySummary[]> => {
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  return repository.listMine();
});

// Whether the nightly evaluation looks at this user's watchlist at all: it evaluates every
// watchlist ticker against each active daily strategy (evaluate-signals.ts), never a subset.
export const hasMyActiveDailyStrategy = cache(async (): Promise<boolean> => {
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  return (await repository.listActiveDaily()).length > 0;
});

export const getMyArchivedStrategies = cache(async (): Promise<StrategySummary[]> => {
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  return repository.listMineArchived();
});

export const getSharedStrategies = cache(async (): Promise<StrategySummary[]> => {
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  return repository.listShared();
});

export const getMyStrategy = cache(async (strategyId: string): Promise<StrategyWithVersions> => {
  const repository = await forCurrentUser(getDb(), StrategiesRepository);
  return repository.findMine(strategyId);
});

export const getStructures = cache(async (): Promise<Structure[]> => {
  return new StructuresRepository(getDb()).listAll();
});

export const getMySignals = cache(async (): Promise<SignalListItem[]> => {
  const repository = await forCurrentUser(getDb(), SignalsRepository);
  return repository.listInbox();
});

export const getMySignal = cache(async (signalId: string): Promise<SignalListItem> => {
  const repository = await forCurrentUser(getDb(), SignalsRepository);
  return repository.findMine(signalId);
});

export const getMyUnreadSignalCount = cache(async (): Promise<number> => {
  const repository = await forCurrentUser(getDb(), SignalsRepository);
  return repository.unreadCount();
});

export const getMyEvaluationLog = cache(async (): Promise<EvaluationLogItem[]> => {
  const repository = await forCurrentUser(getDb(), SignalsRepository);
  return repository.listEvaluationLog();
});
