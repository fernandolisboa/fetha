import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth";
import {
  AUTO_RUN_PARAM,
  BacktestRunNotFoundError,
  runErrorMessage,
  getMyBacktestRun,
  isDiscardedRun,
  isResumableRunError,
  ReadingNotes,
  ReportPanel,
  t,
} from "@/modules/backtests";
import { DiscardRunButton, RunBacktestButton } from "@/modules/backtests/client";
import { ErrorNotice } from "@/components/error-notice";
import { isAnalysisAvailable } from "@/modules/ai-models";
import {
  AnalysisPanel,
  getMyAnalysisUsage,
  getMyLatestAnalyses,
  t as decisionsT,
} from "@/modules/decisions";
import { RequestAnalysisButton } from "@/modules/decisions/client";
import { formatDate } from "@/lib/format/date-time";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { PageHeader, Panel } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.report.overline}` };
export const maxDuration = 120;

export default async function BacktestReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { runId } = await params;
  const autoRun = (await searchParams)[AUTO_RUN_PARAM] === "1";

  const run = await getMyBacktestRun(runId).catch((error: unknown) => {
    if (error instanceof BacktestRunNotFoundError) return null;
    throw error;
  });

  if (!run) {
    notFound();
  }

  const isComplete = run.status === "complete" && run.result !== null;
  const [latestAnalyses, analysisUsage] = await Promise.all([
    getMyLatestAnalyses("backtest_run", isComplete ? [run.id] : []),
    getMyAnalysisUsage(),
  ]);
  const latest = latestAnalyses.get(run.id) ?? null;
  const analysisAvailable = await isAnalysisAvailable();

  return (
    <div className="@container flex flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={t.report.overline}
        headline={
          <>
            <span className="font-mono tabular-nums">
              {formatDate(sessionDateToDisplayDate(run.period.from))}
            </span>{" "}
            —{" "}
            <span className="font-mono tabular-nums">
              {formatDate(sessionDateToDisplayDate(run.period.to))}
            </span>
          </>
        }
        actions={
          isComplete ? (
            <RequestAnalysisButton
              subjectKind="backtest_run"
              subjectId={run.id}
              hasExistingAnalysis={latest !== null}
              usage={analysisUsage}
              available={analysisAvailable}
            />
          ) : undefined
        }
      />

      {run.status === "complete" && run.result ? (
        <>
          <ReportPanel run={run.result} />
          <div className="grid items-start gap-[14px] @min-[64rem]:grid-cols-2">
            <ReadingNotes strategyId={run.strategyId} />
            <Panel title={decisionsT.analysis.report.title}>
              {latest ? (
                <AnalysisPanel analysis={latest} />
              ) : (
                <p className="text-muted-foreground text-sm">{decisionsT.analysis.report.empty}</p>
              )}
            </Panel>
          </div>
        </>
      ) : isDiscardedRun(run) ? (
        <Panel>
          <p className="text-muted-foreground text-sm">{t.discard.reason}</p>
        </Panel>
      ) : run.status === "failed" ? (
        <Panel>
          <ErrorNotice className="text-sm" live={false}>
            {t.report.failed.replace("{error}", runErrorMessage(run.error ?? ""))}
          </ErrorNotice>
          {isResumableRunError(run.error) ? (
            <RunBacktestButton runId={run.id} label={t.report.retry} />
          ) : (
            <p className="text-muted-foreground text-sm">{t.report.cannotResume}</p>
          )}
        </Panel>
      ) : (
        <Panel>
          <p className="text-muted-foreground text-sm">
            {run.status === "paused" && run.sessionsDone !== null && run.sessionsTotal !== null
              ? t.report.paused
                  .replace("{sessionsDone}", String(run.sessionsDone))
                  .replace("{sessionsTotal}", String(run.sessionsTotal))
              : t.report.pending}
          </p>
          <div className="flex flex-wrap gap-2">
            <RunBacktestButton
              runId={run.id}
              label={run.status === "paused" ? t.report.resume : t.report.run}
              autoStart={autoRun && run.status === "pending"}
            />
            <DiscardRunButton
              runId={run.id}
              runLabel={`${formatDate(sessionDateToDisplayDate(run.period.from))} — ${formatDate(sessionDateToDisplayDate(run.period.to))}`}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
