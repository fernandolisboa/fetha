import { cache } from "react";

import { getDb } from "@/db/client";
import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { forCurrentUser } from "@/modules/auth";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { getMyArchivedStrategies, getMyStrategies, getMyStrategy } from "@/modules/strategies";

import {
  BacktestRunRepository,
  type BacktestRunRecord,
  type BacktestRunSummary,
} from "./backtest-run-repository";
import { runLabels, type ComparedRun, type PickerGroup } from "./comparison";
import type { ActiveRunStatus } from "./run-status";

export const getMyBacktestRun = cache(async (runId: string): Promise<BacktestRunRecord> => {
  const repository = await forCurrentUser(getDb(), BacktestRunRepository);
  return repository.findMine(runId);
});

export interface ActiveBacktestRunItem {
  id: string;
  strategyId: string;
  strategyName: string;
  status: ActiveRunStatus;
  period: string;
  sessionsDone: number | null;
  sessionsTotal: number | null;
  createdAt: Date;
}

// Every run still holding an active-cap slot, across every strategy
// (ADR-0032's own residual): what the "Em andamento" panel lists, so a user
// refused at the cap can find and discard one without hunting through
// strategies one by one.
export const getMyActiveBacktestRuns = cache(async (): Promise<ActiveBacktestRunItem[]> => {
  const repository = await forCurrentUser(getDb(), BacktestRunRepository);
  const [active, strategies, archived] = await Promise.all([
    repository.listMineActive(),
    getMyStrategies(),
    getMyArchivedStrategies(),
  ]);
  const names = new Map(
    [...strategies, ...archived].map((strategy) => [strategy.id, strategy.name]),
  );
  return active.map((run) => ({
    id: run.id,
    strategyId: run.strategyId,
    strategyName: names.get(run.strategyId) ?? "",
    status: run.status,
    period: `${formatDate(sessionDateToDisplayDate(run.period.from))} – ${formatDate(sessionDateToDisplayDate(run.period.to))}`,
    sessionsDone: run.sessionsDone,
    sessionsTotal: run.sessionsTotal,
    createdAt: run.createdAt,
  }));
});

export const getMyBacktestRunsForStrategy = cache(
  async (strategyId: string): Promise<BacktestRunRecord[]> => {
    const repository = await forCurrentUser(getDb(), BacktestRunRepository);
    return repository.listMineForStrategy(strategyId);
  },
);

export const getMyCompletedRunSummaries = cache(async (): Promise<BacktestRunSummary[]> => {
  const repository = await forCurrentUser(getDb(), BacktestRunRepository);
  return repository.listMineCompleteSummaries();
});

export const getMyCompletedRuns = cache(
  async (ids: readonly string[]): Promise<BacktestRunRecord[]> => {
    const repository = await forCurrentUser(getDb(), BacktestRunRepository);
    return repository.findMineComplete(ids);
  },
);

export type Comparison = { groups: PickerGroup[]; runs: ComparedRun[] };

// Reads persisted, completed runs only (ADR-0023): nothing is re-simulated to compare.
export async function getMyComparison(ids: readonly string[]): Promise<Comparison> {
  const [summaries, records] = await Promise.all([
    getMyCompletedRunSummaries(),
    ids.length >= 2 ? getMyCompletedRuns(ids) : Promise.resolve([]),
  ]);
  const strategyIds = [...new Set(summaries.map((summary) => summary.strategyId))];
  const withVersions = await Promise.all(strategyIds.map((id) => getMyStrategy(id)));
  const names = new Map(withVersions.map((strategy) => [strategy.id, strategy.name]));
  const versionNumbers = new Map(
    withVersions.flatMap((strategy) =>
      strategy.versions.map((version) => [version.id, version.versionNumber] as const),
    ),
  );
  const labelInput = (run: {
    id: string;
    strategyId: string;
    strategyVersionId: string;
    createdAt: Date;
  }) => ({
    id: run.id,
    strategyId: run.strategyId,
    strategyName: names.get(run.strategyId) ?? "",
    versionNumber: versionNumbers.get(run.strategyVersionId) ?? 0,
    createdAt: formatDateTime(run.createdAt),
  });

  const pickerLabels = new Map<string, string>();
  for (const strategyId of strategyIds) {
    const own = summaries.filter((summary) => summary.strategyId === strategyId);
    for (const [id, label] of runLabels(own.map(labelInput))) pickerLabels.set(id, label);
  }
  const groups: PickerGroup[] = strategyIds.map((strategyId) => ({
    strategyId,
    strategyName: names.get(strategyId) ?? "",
    runs: summaries
      .filter((summary) => summary.strategyId === strategyId)
      .map((summary) => ({
        id: summary.id,
        label: pickerLabels.get(summary.id) ?? "",
        period: `${formatDate(sessionDateToDisplayDate(summary.period.from))} – ${formatDate(sessionDateToDisplayDate(summary.period.to))}`,
      })),
  }));

  const complete = records.flatMap((record) =>
    record.result ? [{ record, result: record.result }] : [],
  );
  const labels = runLabels(complete.map(({ record }) => labelInput(record)));
  const runs: ComparedRun[] = complete.map(({ record, result }) => ({
    id: record.id,
    href: `/estrategias/${record.strategyId}/backtests/${record.id}`,
    label: labels.get(record.id) ?? "",
    result,
  }));
  return { groups, runs };
}
