import { cache } from "react";
import type { Structure } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

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
