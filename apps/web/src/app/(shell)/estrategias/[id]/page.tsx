import type { Metadata } from "next";
import type { SessionDate } from "@fetha/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, formatDateTime } from "@/lib/format/date-time";
import { requireUser } from "@/modules/auth";
import {
  compareHref,
  getMyBacktestRunsForStrategy,
  isActiveRun,
  t as backtestsStrings,
} from "@/modules/backtests";
import { DiscardRunButton } from "@/modules/backtests/client";
import { sessionDateToDisplayDate } from "@/modules/market-data";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, Panel, t as shellStrings } from "@/modules/shell";
import { getMyStrategy, getStructures, StrategyNotFoundError, t } from "@/modules/strategies";
import {
  ShareToggleButton,
  StrategyActiveToggle,
  StrategyEditorForm,
  UnarchiveStrategyButton,
} from "@/modules/strategies/client";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.strategies}` };

function periodLabel(period: { from: SessionDate; to: SessionDate }): string {
  return `${formatDate(sessionDateToDisplayDate(period.from))} – ${formatDate(sessionDateToDisplayDate(period.to))}`;
}

export default async function EditStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const [structures, strategy, runs] = await Promise.all([
    getStructures(),
    getMyStrategy(id).catch((error: unknown) => {
      if (error instanceof StrategyNotFoundError) {
        return null;
      }
      throw error;
    }),
    getMyBacktestRunsForStrategy(id),
  ]);

  if (!strategy) {
    notFound();
  }

  const completedRunIds = runs.filter((run) => run.status === "complete").map((run) => run.id);
  const latestVersion = strategy.versions[strategy.versions.length - 1];
  if (!latestVersion) {
    notFound();
  }
  const archived = strategy.archivedAt !== null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <PageHeader
        overline={archived ? t.editor.archivedOverline : t.editor.editOverline}
        headline={strategy.name}
        actions={
          <div className="flex items-center gap-4">
            {archived ? (
              <>
                <Badge variant="outline">{t.editor.archivedBadge}</Badge>
                <UnarchiveStrategyButton strategyId={strategy.id} strategyName={strategy.name} />
              </>
            ) : (
              <>
                <StrategyActiveToggle strategyId={strategy.id} active={strategy.active} />
                <ShareToggleButton
                  strategyId={strategy.id}
                  strategyName={strategy.name}
                  visibility={strategy.visibility}
                />
              </>
            )}
          </div>
        }
      />

      {archived ? (
        <Panel title={t.editor.readOnlyTitle}>
          <p className="text-muted-foreground text-sm">{t.editor.errors.archived}</p>
        </Panel>
      ) : (
        <StrategyEditorForm
          structures={structures}
          strategyId={strategy.id}
          initial={latestVersion.definition}
        />
      )}

      <Panel title={t.editor.versions.title}>
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {strategy.versions.map((version) => (
            <li key={version.id} className="font-mono tabular-nums">
              v{version.versionNumber} · {t.editor.versions.createdAt}{" "}
              {formatDateTime(version.createdAt)}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={backtestsStrings.report.overline}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {archived ? null : (
              <Link
                href={`/estrategias/${strategy.id}/backtests/novo`}
                className={buttonVariants()}
              >
                {backtestsStrings.create.submit}
              </Link>
            )}
            {completedRunIds.length >= 2 ? (
              <Link
                href={compareHref(completedRunIds.slice(0, 2))}
                className={buttonVariants({ variant: "outline" })}
              >
                {backtestsStrings.compare.link}
              </Link>
            ) : null}
          </div>
          {runs.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/estrategias/${strategy.id}/backtests/${run.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {periodLabel(run.period)}
                  </Link>{" "}
                  <span className="text-muted-foreground text-xs">
                    ({formatDate(run.createdAt)})
                  </span>
                  {isActiveRun(run) ? (
                    <DiscardRunButton runId={run.id} runLabel={periodLabel(run.period)} />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
