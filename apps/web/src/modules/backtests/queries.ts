import { cache } from "react";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { BacktestRunRepository, type BacktestRunRecord } from "./backtest-run-repository";

export const getMyBacktestRun = cache(async (runId: string): Promise<BacktestRunRecord> => {
  const repository = await forCurrentUser(getDb(), BacktestRunRepository);
  return repository.findMine(runId);
});

export const getMyBacktestRunsForStrategy = cache(
  async (strategyId: string): Promise<BacktestRunRecord[]> => {
    const repository = await forCurrentUser(getDb(), BacktestRunRepository);
    return repository.listMineForStrategy(strategyId);
  },
);
