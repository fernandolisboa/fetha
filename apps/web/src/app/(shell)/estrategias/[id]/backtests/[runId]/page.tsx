import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireUser } from "@/modules/auth";
import {
  BacktestRunNotFoundError,
  getMyBacktestRun,
  ReportPanel,
  RunBacktestButton,
  t,
} from "@/modules/backtests";
import { formatDate } from "@/lib/format/date-time";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";

export const metadata: Metadata = { title: `Fetha · ${t.report.overline}` };

export default async function BacktestReportPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  await requireUser();
  const { runId } = await params;

  const run = await getMyBacktestRun(runId).catch((error: unknown) => {
    if (error instanceof BacktestRunNotFoundError) return null;
    throw error;
  });

  if (!run) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8">
      <div>
        <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {t.report.overline}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight">
          <span className="font-mono tabular-nums">
            {formatDate(sessionDateToDisplayDate(run.period.from))}
          </span>{" "}
          —{" "}
          <span className="font-mono tabular-nums">
            {formatDate(sessionDateToDisplayDate(run.period.to))}
          </span>
        </h1>
      </div>

      {run.status === "complete" && run.result ? (
        <ReportPanel run={run.result} />
      ) : run.status === "failed" ? (
        <Panel>
          <p className="text-destructive text-sm">
            {t.report.failed.replace("{error}", run.error ?? "")}
          </p>
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
          <RunBacktestButton
            runId={run.id}
            label={run.status === "paused" ? t.report.resume : t.report.run}
          />
        </Panel>
      )}
    </div>
  );
}
